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

        if not audio_bytes:
            return None

        self.buffer_manager.add_chunk(audio_bytes)
        audio_chunk = self.buffer_manager.get_processed_chunk()
        if audio_chunk is None:
            # 버퍼링 중 - 아직 충분한 데이터가 없음
            return None

        # 오디오 청크 정보 로깅
        audio_duration = len(audio_chunk) / self.buffer_manager.sample_rate
        LOGGER.info("[INFO] Processing audio chunk: duration=%.2f sec, samples=%d", audio_duration, len(audio_chunk))

        start_time = time.perf_counter()
        
        # STT 호출 전 로그
        LOGGER.info("[INFO] Calling STT service...")
        text = await asyncio.to_thread(self.stt_service.transcribe, audio_chunk)
        LOGGER.info("[INFO] STT service returned: '%s'", text if text else "(empty)")
        
        # STT 결과 로그 출력 (디버깅) - 항상 출력
        if text and text.strip():
            LOGGER.info("[INFO] STT result: '%s' (length: %d)", text, len(text))
        else:
            LOGGER.warning("[WARN] STT result is empty or whitespace only! Audio may not contain speech or STT failed.")
            # 빈 문자열을 명시적으로 설정
            text = "" if not text else text.strip()
        
        # 키워드 목록 확인 (디버깅) - 항상 출력
        if not self.keywords:
            LOGGER.error("[ERROR] No keywords provided to pipeline! Keyword detection will not work.")
        else:
            LOGGER.info("[INFO] Keywords count: %d (first few: %s)", len(self.keywords), self.keywords[:5] if len(self.keywords) > 5 else self.keywords)
        
        # 키워드 기반 검사 (항상 수행)
        keyword_harmful = False
        matched_keywords = []
        
        if text and text.strip():  # 텍스트가 비어있지 않을 때만 검사
            text_lower = text.lower()
            if self.keywords:
                matched_keywords = [word for word in self.keywords if word.lower() in text_lower]
                keyword_harmful = len(matched_keywords) > 0
                
                # 키워드 감지 시 로그 출력
                if keyword_harmful:
                    LOGGER.warning("[ALERT] Keyword detected in audio: %s in '%s'", matched_keywords, text)
                else:
                    LOGGER.info("[INFO] No keywords matched in text: '%s'", text)
        else:
            LOGGER.warning("[WARN] Skipping keyword check - STT result is empty. Audio duration: %.2f sec", len(audio_chunk) / self.buffer_manager.sample_rate)
        
        # Classifier가 있으면 Classifier도 사용 (키워드 + Classifier 결합)
        if self.classifier is not None:
            # 텍스트가 비어있으면 Classifier도 스킵 (빈 텍스트는 유해하지 않음)
            if text and text.strip():
                classifier_result = await asyncio.to_thread(self.classifier.predict, text)
                
                # 키워드 또는 Classifier 중 하나라도 유해하다고 판단하면 유해로 처리
                # 키워드가 감지되면 confidence를 1.0으로 설정 (키워드 우선)
                is_harmful = keyword_harmful or classifier_result.is_harmful
                if keyword_harmful:
                    confidence = 1.0  # 키워드 감지 시 최고 신뢰도
                else:
                    confidence = classifier_result.confidence
            else:
                # 빈 텍스트는 키워드 검사 결과만 사용
                is_harmful = keyword_harmful
                confidence = 1.0 if keyword_harmful else 0.0
                
            classification = ClassificationResult(
                is_harmful=is_harmful,
                confidence=confidence,
                text=text if text else ""  # 빈 문자열 명시
            )
        else:
            # 키워드 기반 분류만 사용
            classification = ClassificationResult(
                is_harmful=keyword_harmful,
                confidence=1.0 if keyword_harmful else 0.0,
                text=text if text else ""  # 빈 문자열 명시
            )
        
        # 최종 결과 로그 출력 (디버깅) - 항상 출력
        text_preview = text[:50] if text and text.strip() else "(empty)"
        LOGGER.info(
            "[INFO] Pipeline result: text='%s', is_harmful=%s, confidence=%.2f, matched_keywords=%s, has_classifier=%s",
            text_preview,
            classification.is_harmful,
            classification.confidence,
            matched_keywords,
            self.classifier is not None
        )

        elapsed_ms = (time.perf_counter() - start_time) * 1000

        return PipelineOutput(
            text=text,
            classification=classification,
            audio_duration_sec=len(audio_chunk) / self.buffer_manager.sample_rate,
            processing_time_ms=elapsed_ms,
        )

