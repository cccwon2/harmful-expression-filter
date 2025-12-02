"""
PaddleOCR 기반 텍스트 추출 서비스
Task 28: PaddleOCR 서버 연동
"""
import time
import numpy as np
from paddleocr import PaddleOCR
from PIL import Image
from typing import Tuple, List, Optional
import logging
import os

logger = logging.getLogger(__name__)


class PaddleOCRService:
    """
    PaddleOCR 기반 텍스트 추출 서비스
    """

    def __init__(self):
        """
        PaddleOCR 모델 초기화 (한국어)
        """
        try:
            logger.info("[PaddleOCR] 모델 초기화 중...")
            # 환경 변수에서 GPU 사용 여부 확인
            use_gpu = os.getenv("PADDLEOCR_USE_GPU", "false").lower() == "true"
            lang = os.getenv("PADDLEOCR_LANG", "korean")

            self.ocr = PaddleOCR(
                use_angle_cls=True,
                lang=lang,
                use_gpu=use_gpu,  # GPU 사용 여부 (환경 변수로 제어)
                show_log=False,
            )

            logger.info(f"[PaddleOCR] ✅ 초기화 완료 (GPU: {use_gpu}, Lang: {lang})")
        except Exception as e:
            logger.error(f"[PaddleOCR] ❌ 초기화 실패: {e}", exc_info=True)
            raise

    def extract_text(self, image: Image.Image) -> Tuple[List[str], float]:
        """
        이미지에서 텍스트 추출

        Args:
            image: PIL.Image 객체

        Returns:
            (texts, processing_time): 추출된 텍스트 리스트와 처리 시간(초)
        """
        try:
            # PIL 이미지를 numpy array로 변환
            if hasattr(image, "convert"):
                image_array = np.array(image.convert("RGB"))
            else:
                image_array = image

            # OCR 실행 및 시간 측정
            start_time = time.time()
            result = self.ocr.ocr(image_array, cls=True)
            end_time = time.time()
            processing_time = end_time - start_time

            # 결과 파싱
            texts = []
            # PaddleOCR 결과 형식: result는 리스트이며, 각 페이지가 리스트로 반환됨
            # 텍스트가 없으면 None 또는 빈 리스트가 반환될 수 있음
            if result and len(result) > 0 and result[0] is not None:
                # result[0]은 첫 번째 페이지의 결과 리스트
                page_result = result[0]
                if isinstance(page_result, list):
                    for line in page_result:
                        if line and len(line) > 1:
                            # line 형식: [[좌표], (텍스트, 신뢰도)]
                            text_info = line[1]
                            if text_info and isinstance(text_info, (tuple, list)) and len(text_info) > 0:
                                text = text_info[0]  # (text, confidence)에서 text만 추출
                                if text and isinstance(text, str) and text.strip():
                                    texts.append(text.strip())

            logger.debug(
                f"[PaddleOCR] OCR 완료: {len(texts)}개 텍스트, {processing_time:.3f}초"
            )
            return texts, processing_time

        except Exception as e:
            logger.error(f"[PaddleOCR] OCR 처리 중 오류: {e}", exc_info=True)
            return [], 0.0


# 전역 싱글톤 인스턴스
_ocr_service_instance: Optional[PaddleOCRService] = None


def get_ocr_service() -> PaddleOCRService:
    """
    OCR 서비스 싱글톤 인스턴스 반환
    """
    global _ocr_service_instance
    if _ocr_service_instance is None:
        _ocr_service_instance = PaddleOCRService()
    return _ocr_service_instance

