"""
Phase 1: AudioBufferManager 단위 테스트.
"""

import numpy as np
import pytest

from audio.buffer_manager import AudioBufferManager


def test_add_and_retrieve_chunk() -> None:
    """
    버퍼에 1초 분량의 오디오 데이터를 추가하면 float32 정규화 배열을 반환하는지 확인한다.
    """

    manager = AudioBufferManager(sample_rate=16_000, chunk_duration_sec=1.0)

    dummy_audio = np.random.randint(-32768, 32767, manager.chunk_size, dtype=np.int16)
    manager.add_chunk(dummy_audio.tobytes())

    chunk = manager.get_processed_chunk()

    assert chunk is not None
    assert chunk.shape == (manager.chunk_size,)
    assert chunk.dtype == np.float32
    assert np.all(chunk >= -1.0) and np.all(chunk <= 1.0)


def test_partial_chunk_returns_none() -> None:
    """
    충분한 샘플이 누적되지 않은 경우 None을 반환해야 한다.
    """

    manager = AudioBufferManager(sample_rate=16_000, chunk_duration_sec=1.0)

    partial_audio = np.zeros(manager.chunk_size // 2, dtype=np.int16).tobytes()
    manager.add_chunk(partial_audio)

    assert manager.get_processed_chunk() is None


def test_reset_clears_buffer() -> None:
    """
    reset 호출 시 버퍼가 초기화되어 get_processed_chunk가 None을 반환한다.
    """

    manager = AudioBufferManager(sample_rate=16_000, chunk_duration_sec=1.0)
    dummy_audio = np.ones(manager.chunk_size, dtype=np.int16).tobytes()
    manager.add_chunk(dummy_audio)

    manager.reset()

    assert manager.get_processed_chunk() is None


def test_invalid_parameters_raise_error() -> None:
    """
    음수/0 샘플레이트 혹은 청크 길이 입력 시 ValueError 발생을 검증한다.
    """

    with pytest.raises(ValueError):
        AudioBufferManager(sample_rate=0, chunk_duration_sec=1.0)

    with pytest.raises(ValueError):
        AudioBufferManager(sample_rate=16_000, chunk_duration_sec=0.0)

