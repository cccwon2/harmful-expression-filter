"""
STT 서비스 초기화 테스트 스크립트
"""
import sys
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("test")

try:
    from audio.whisper_service import WhisperSTTService, WhisperNotAvailableError
    
    logger.info("Testing Whisper STT Service initialization...")
    try:
        stt_service = WhisperSTTService(model_name="base")
        logger.info("✅ Whisper STT Service initialized successfully!")
        logger.info(f"Model: {stt_service.model_name}")
    except WhisperNotAvailableError as e:
        logger.error(f"❌ WhisperNotAvailableError: {e}")
    except Exception as e:
        logger.error(f"❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
except ImportError as e:
    logger.error(f"❌ Import error: {e}")

