"""
Phase 2: WhisperSTTService 단위 테스트.
"""

from __future__ import annotations

import importlib
import sys
import types
from typing import Any, Dict

import numpy as np
import pytest


def _install_fake_whisper(monkeypatch, model_response: Dict[str, Any]):
    """
    whisper 모듈을 대체하는 가짜 모듈을 sys.modules에 주입한다.
    """

    class FakeModel:
        def transcribe(self, audio, *, language, fp16):
            assert language == "ko"
            assert fp16 is False
            return model_response

    def fake_load_model(model_name: str):
        assert model_name == "base"
        return FakeModel()

    fake_module = types.SimpleNamespace(load_model=fake_load_model)
    monkeypatch.setitem(sys.modules, "whisper", fake_module)


def test_whisper_service_transcribe(monkeypatch):
    """
    WhisperSTTService가 주입된 가짜 whisper 모델을 통해 텍스트를 반환하는지 검증한다.
    """

    expected_text = "안녕하세요"
    _install_fake_whisper(monkeypatch, {"text": f" {expected_text}  "})

    module = importlib.import_module("audio.whisper_service")
    importlib.reload(module)

    service = module.WhisperSTTService(model_name="base")
    dummy_audio = np.zeros(16000, dtype=np.float32)
    result = service.transcribe(dummy_audio)

    assert result == expected_text


def test_whisper_service_validates_input(monkeypatch):
    """
    입력 배열의 형상/길이 검증이 작동하는지 확인한다.
    """

    _install_fake_whisper(monkeypatch, {"text": ""})
    module = importlib.import_module("audio.whisper_service")
    importlib.reload(module)
    service = module.WhisperSTTService(model_name="base")

    with pytest.raises(ValueError):
        service.transcribe(np.zeros((16000, 1), dtype=np.float32))

    with pytest.raises(ValueError):
        service.transcribe(np.array([], dtype=np.float32))


def test_whisper_service_custom_loader(monkeypatch):
    """
    model_loader 인자를 통해 외부에서 모델을 주입할 수 있는지 검증한다.
    """

    class DummyModel:
        def transcribe(self, audio, *, language, fp16):
            return {"text": "테스트"}

    module = importlib.import_module("audio.whisper_service")
    importlib.reload(module)
    service = module.WhisperSTTService(model_name="base", model_loader=lambda _: DummyModel())

    output = service.transcribe(np.ones(4, dtype=np.float32))
    assert output == "테스트"

