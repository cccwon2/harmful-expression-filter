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
    지연 초기화(Lazy Initialization)를 사용하여 서버 시작 시 블로킹을 방지합니다.
    """
    
    def __init__(self):
        """
        PaddleOCR 서비스 초기화 (모델은 첫 요청 시 로드)
        """
        self.ocr = None
        self.lang = os.getenv('PADDLEOCR_LANG', 'korean')
        self._initializing = False
        # PaddleOCR 3.x에서는 use_gpu, use_angle_cls, show_log 파라미터가 제거됨
        # GPU 사용은 PaddlePaddle 설치 버전(paddlepaddle vs paddlepaddle-gpu)으로 결정됨
    
    def _ensure_initialized(self):
        """
        PaddleOCR 모델이 초기화되지 않았다면 초기화합니다.
        """
        if self.ocr is not None:
            return
        
        if self._initializing:
            # 다른 스레드에서 초기화 중이면 대기
            while self._initializing:
                time.sleep(0.1)
            return
        
        try:
            self._initializing = True
            logger.info(f"PaddleOCR 모델 초기화 중... (lang={self.lang})")
            try:
                self.ocr = PaddleOCR(lang=self.lang)
                logger.info(f"PaddleOCR 모델 초기화 완료 (lang={self.lang})")
            except Exception as init_error:
                logger.error(f"PaddleOCR 객체 생성 중 오류: {init_error}", exc_info=True)
                raise
        except Exception as e:
            logger.error(f"PaddleOCR 초기화 실패: {e}")
            raise
        finally:
            self._initializing = False
    
    def extract_text(self, image: Image.Image) -> Tuple[List[str], float]:
        """
        이미지에서 텍스트 추출
        
        Args:
            image: PIL.Image 객체
            
        Returns:
            (texts, processing_time): 추출된 텍스트 리스트와 처리 시간(초)
        """
        # 지연 초기화: 첫 요청 시에만 초기화
        self._ensure_initialized()
        
        try:
            # PIL 이미지를 numpy array로 변환
            if hasattr(image, "convert"):
                image_array = np.array(image.convert("RGB"))
            else:
                image_array = image
            
            # OCR 실행 및 시간 측정
            # PaddleOCR 3.x에서는 cls 파라미터가 ocr() 메서드에 직접 지원되지 않음
            # cls는 PaddleOCR 초기화 시 use_angle_cls 파라미터로 설정됨
            start_time = time.time()
            result = self.ocr.ocr(image_array)
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

