"""
Phase 4: 오디오 → STT → 유해성 분류 파이프라인.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Optional

from .buffer_manager import AudioBufferManager
from .whisper_service import WhisperSTTService, WhisperNotAvailableError
from nlp.harmful_classifier import (
    HarmfulTextClassifier,
    ClassificationResult,
    TransformersNotAvailableError,
)


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
    """

    def __init__(
        self,
        stt_service: WhisperSTTService,
        classifier: HarmfulTextClassifier,
        *,
        sample_rate: int = 16_000,
        chunk_duration_sec: float = 1.0,
    ) -> None:
        if stt_service is None:
            raise WhisperNotAvailableError("Whisper STT 서비스가 초기화되지 않았습니다.")
        if classifier is None:
            raise TransformersNotAvailableError("유해성 분류기가 초기화되지 않았습니다.")

        self.stt_service = stt_service
        self.classifier = classifier
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
            return None

        start_time = time.perf_counter()
        loop = asyncio.get_running_loop()

        text = await asyncio.to_thread(self.stt_service.transcribe, audio_chunk)
        classification = await asyncio.to_thread(self.classifier.predict, text)

        elapsed_ms = (time.perf_counter() - start_time) * 1000

        return PipelineOutput(
            text=text,
            classification=classification,
            audio_duration_sec=len(audio_chunk) / self.buffer_manager.sample_rate,
            processing_time_ms=elapsed_ms,
        )

