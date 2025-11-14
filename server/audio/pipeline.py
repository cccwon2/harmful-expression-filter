"""
Phase 4: 오디오 → STT → 유해성 분류 파이프라인.

이 파이프라인은 WhisperSTTService 또는 DeepgramSTTService와 호환됩니다.
두 서비스 모두 transcribe(audio_chunk: np.ndarray) -> str 인터페이스를 제공합니다.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Optional, Protocol

import numpy as np

from .buffer_manager import AudioBufferManager
from .whisper_service import WhisperSTTService, WhisperNotAvailableError
from .deepgram_service import DeepgramSTTService, DeepgramNotAvailableError
from nlp.harmful_classifier import (
    HarmfulTextClassifier,
    ClassificationResult,
    TransformersNotAvailableError,
)

LOGGER = logging.getLogger("harmful-filter")


class STTServiceProtocol(Protocol):
    """STT 서비스 프로토콜 (WhisperSTTService 또는 DeepgramSTTService와 호환)."""
    
    def transcribe(self, audio_np: np.ndarray) -> str:
        """오디오 배열을 텍스트로 변환."""
        ...



@dataclass
class PipelineOutput:
    """
    파이프라인 처리 결과 데이터 구조.
    """

    text: str
    classification: ClassificationResult
    audio_duration_sec: float
    processing_time_ms: float


class AudioProcessingPipeline:
    """
    WebSocket으로 수신된 오디오 스트림을 버퍼링하고 STT → 분류를 수행한다.
    
    STT 서비스는 WhisperSTTService 또는 DeepgramSTTService를 사용할 수 있습니다.
    두 서비스 모두 transcribe(audio_chunk: np.ndarray) -> str 인터페이스를 제공합니다.
    """

    def __init__(
        self,
        stt_service: STTServiceProtocol,  # WhisperSTTService 또는 DeepgramSTTService
        classifier: Optional[HarmfulTextClassifier],
        *,
        sample_rate: int = 16_000,
        chunk_duration_sec: float = 1.0,
        keywords: Optional[list[str]] = None,
    ) -> None:
        if stt_service is None:
            raise ValueError("STT 서비스가 초기화되지 않았습니다.")
        
        self.stt_service = stt_service
        self.classifier = classifier  # None일 수 있음 (키워드 기반 분류만 사용)
        self.keywords = keywords or []  # 키워드 목록 (main.py의 BAD_WORDS 전달)
        self.buffer_manager = AudioBufferManager(
            sample_rate=sample_rate, chunk_duration_sec=chunk_duration_sec
        )

    async def process_audio(self, audio_bytes: bytes) -> Optional[PipelineOutput]:
        """
        오디오 바이너리를 버퍼에 추가하고, 충분히 쌓이면 STT/분류 결과를 반환한다.
        """
        total_start = time.time()

        if not audio_bytes:
            return None

        # 1. 버퍼에 추가 및 청크 가져오기
        buffer_start = time.time()
        self.buffer_manager.add_chunk(audio_bytes)
        audio_chunk = self.buffer_manager.get_processed_chunk()
        buffer_time = (time.time() - buffer_start) * 1000

        if audio_chunk is None:
            # 버퍼링 중 - 아직 충분한 데이터가 없음
            return None

        # 2. STT 변환
        stt_start = time.time()
        text = await asyncio.to_thread(self.stt_service.transcribe, audio_chunk)
        stt_time = (time.time() - stt_start) * 1000

        if not text or len(text.strip()) == 0:
            LOGGER.info("[Pipeline] No text detected, skipping classification")
            return None

        # 3. 유해성 판단
        classifier_start = time.time()
        
        # 키워드 기반 검사
        keyword_harmful = False
        matched_keywords = []
        text_lower = text.lower()
        if self.keywords:
            matched_keywords = [word for word in self.keywords if word.lower() in text_lower]
            keyword_harmful = len(matched_keywords) > 0

        # Classifier가 있으면 Classifier도 사용
        if self.classifier is not None:
            classifier_result = await asyncio.to_thread(self.classifier.predict, text)
            is_harmful = keyword_harmful or classifier_result.is_harmful
            if keyword_harmful:
                confidence = 1.0
            else:
                confidence = classifier_result.confidence
        else:
            is_harmful = keyword_harmful
            confidence = 1.0 if keyword_harmful else 0.0

        classifier_time = (time.time() - classifier_start) * 1000
        total_time = (time.time() - total_start) * 1000

        # ✅ 세부 레이턴시 로깅
        LOGGER.info(
            "[Pipeline] Total: %.2fms | Buffer: %.2fms | STT: %.2fms | Classifier: %.2fms | Text: '%s'",
            total_time, buffer_time, stt_time, classifier_time, text[:50]
        )

        # ⚠️ 목표 3초 초과 경고
        if total_time > 3000:
            LOGGER.warning("[Pipeline] ⚠️ Total latency exceeds 3s: %.2fms", total_time)

        classification = ClassificationResult(
            is_harmful=is_harmful,
            confidence=confidence,
            text=text
        )

        return PipelineOutput(
            text=text,
            classification=classification,
            audio_duration_sec=len(audio_chunk) / self.buffer_manager.sample_rate,
            processing_time_ms=total_time,
        )

