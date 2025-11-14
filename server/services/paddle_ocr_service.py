# [Server: server/services/paddle_ocr_service.py]
import time
import os
import numpy as np
from paddleocr import PaddleOCR
from PIL import Image
from typing import Tuple, List
import logging

logger = logging.getLogger(__name__)

class PaddleOCRService:
    """
    PaddleOCR 기반 텍스트 추출 서비스
    """
    
    def __init__(self):
        """
        PaddleOCR 모델 초기화 (.env 파일의 설정 사용)
        """
        try:
            # .env 파일에서 설정 읽기
            lang = os.getenv('PADDLEOCR_LANG', 'korean')
            use_gpu_str = os.getenv('PADDLEOCR_USE_GPU', 'false').lower()
            use_gpu = use_gpu_str in ('true', '1', 'yes')
            
            logger.info(f"PaddleOCR 모델 초기화 중... (lang={lang}, use_gpu={use_gpu})")
            self.ocr = PaddleOCR(
                use_angle_cls=True,
                lang=lang,
                use_gpu=use_gpu,
                show_log=False
            )
            logger.info(f"PaddleOCR 모델 초기화 완료 (lang={lang}, use_gpu={use_gpu})")
        except Exception as e:
            logger.error(f"PaddleOCR 초기화 실패: {e}")
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
            if result and len(result) > 0:
                for line in result[0]:  # result[0]이 첫 번째 페이지
                    if line and len(line) > 1:
                        text = line[1][0]  # (text, confidence)에서 text만 추출
                        texts.append(text)
            
            logger.info(f"OCR 완료: {len(texts)}개 텍스트, {processing_time:.3f}초")
            return texts, processing_time
            
        except Exception as e:
            logger.error(f"OCR 처리 중 오류: {e}")
            return [], 0.0

# 전역 싱글톤 인스턴스
_ocr_service_instance = None

def get_ocr_service() -> PaddleOCRService:
    """
    OCR 서비스 싱글톤 인스턴스 반환
    """
    global _ocr_service_instance
    if _ocr_service_instance is None:
        _ocr_service_instance = PaddleOCRService()
    return _ocr_service_instance

