"""
Phase 1: 오디오 버퍼 관리 클래스 구현.
"""

from collections import deque
from typing import Deque, Optional

import numpy as np


class AudioBufferManager:
    """
    16kHz PCM 16-bit 모노 오디오 스트림을 일정 길이(chunk_duration_sec)로 버퍼링하고
    STT 엔진이 필요로 하는 float32(-1.0 ~ 1.0) 배열로 변환하는 관리 클래스.
    """

    def __init__(self, sample_rate: int = 16_000, chunk_duration_sec: float = 1.0) -> None:
        """
        Args:
            sample_rate: 오디오 샘플링 레이트 (Hz)
            chunk_duration_sec: 처리할 청크 길이 (초)
        """

        if sample_rate <= 0:
            raise ValueError("sample_rate must be positive.")
        if chunk_duration_sec <= 0:
            raise ValueError("chunk_duration_sec must be positive.")

        self.sample_rate = sample_rate
        self.chunk_size = int(sample_rate * chunk_duration_sec)
        self.buffer: Deque[int] = deque()

    def add_chunk(self, audio_bytes: bytes) -> None:
        """
        PCM 16-bit 바이너리 오디오 데이터를 버퍼에 추가한다.

        Args:
            audio_bytes: 리틀엔디언 PCM 16-bit( signed int16 ) 바이너리
        """

        if not audio_bytes:
            return

        audio_np = np.frombuffer(audio_bytes, dtype=np.int16)

        # deque에 int16 값을 바로 저장 (popleft할 때 변환 없이 사용)
        self.buffer.extend(audio_np.tolist())

    def get_processed_chunk(self) -> Optional[np.ndarray]:
        """
        chunk_size 만큼 샘플이 쌓이면 float32 정규화 배열을 반환한다.
        누적 샘플이 부족한 경우 None을 반환한다.
        """

        if len(self.buffer) < self.chunk_size:
            return None

        samples = [self.buffer.popleft() for _ in range(self.chunk_size)]
        audio_chunk = np.array(samples, dtype=np.float32) / 32768.0

        return audio_chunk

    def reset(self) -> None:
        """
        버퍼를 완전히 초기화한다.
        """

        self.buffer.clear()

