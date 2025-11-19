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
        import sys
        
        if self.ocr is not None:
            logger.info("PaddleOCR 이미 초기화됨")
            print("[PaddleOCR] 이미 초기화됨", file=sys.stderr)
            return
        
        if self._initializing:
            # 다른 스레드에서 초기화 중이면 대기
            logger.info("PaddleOCR 초기화 대기 중... (다른 스레드에서 초기화 진행 중)")
            print("[PaddleOCR] 초기화 대기 중...", file=sys.stderr)
            wait_count = 0
            while self._initializing:
                time.sleep(0.1)
                wait_count += 1
                if wait_count > 300:  # 30초 타임아웃
                    logger.error("PaddleOCR 초기화 대기 타임아웃 (30초)")
                    print("[PaddleOCR] 초기화 대기 타임아웃!", file=sys.stderr)
                    raise RuntimeError("PaddleOCR 초기화 대기 타임아웃")
            logger.info("PaddleOCR 초기화 대기 완료")
            print("[PaddleOCR] 초기화 대기 완료", file=sys.stderr)
            if self.ocr is None:
                raise RuntimeError("PaddleOCR 초기화가 완료되었지만 객체가 None입니다")
            return
        
        try:
            self._initializing = True
            init_start = time.time()
            
            logger.info(f"PaddleOCR 모델 초기화 시작... (lang={self.lang})")
            print(f"[PaddleOCR] 모델 초기화 시작... (lang={self.lang})", file=sys.stderr)
            
            try:
                # PaddleOCR 3.x에서는 show_log=False 파라미터가 제거됨
                # lang 파라미터만 전달
                self.ocr = PaddleOCR(lang=self.lang)
                init_time = time.time() - init_start
                logger.info(f"PaddleOCR 모델 초기화 완료 (lang={self.lang}, 소요 시간: {init_time:.3f}초)")
                print(f"[PaddleOCR] 모델 초기화 완료 (소요 시간: {init_time:.3f}초)", file=sys.stderr)
            except Exception as init_error:
                init_time = time.time() - init_start
                error_msg = f"PaddleOCR 객체 생성 중 오류 (소요 시간: {init_time:.3f}초): {init_error}"
                logger.error(error_msg, exc_info=True)
                print(f"[PaddleOCR] 객체 생성 실패: {error_msg}", file=sys.stderr)
                raise RuntimeError(error_msg) from init_error
        except Exception as e:
            error_msg = f"PaddleOCR 초기화 실패: {e}"
            logger.error(error_msg, exc_info=True)
            print(f"[PaddleOCR] 초기화 실패: {error_msg}", file=sys.stderr)
            raise RuntimeError(error_msg) from e
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
        import sys
        
        # 지연 초기화: 첫 요청 시에만 초기화
        logger.info("[PaddleOCR] extract_text 호출됨 - 초기화 확인 시작")
        print("[PaddleOCR] extract_text 호출됨", file=sys.stderr)
        
        try:
            logger.info("[PaddleOCR] _ensure_initialized() 호출 중...")
            print("[PaddleOCR] _ensure_initialized() 호출 중...", file=sys.stderr)
            self._ensure_initialized()
            logger.info("[PaddleOCR] _ensure_initialized() 완료")
            print("[PaddleOCR] _ensure_initialized() 완료", file=sys.stderr)
        except Exception as init_error:
            error_msg = f"PaddleOCR 초기화 실패: {init_error}"
            logger.error(error_msg, exc_info=True)
            print(f"[PaddleOCR] 초기화 실패: {error_msg}", file=sys.stderr)
            raise RuntimeError(error_msg) from init_error
        
        if self.ocr is None:
            error_msg = "PaddleOCR 객체가 초기화되지 않았습니다"
            logger.error(error_msg)
            print(f"[PaddleOCR] 에러: {error_msg}", file=sys.stderr)
            raise RuntimeError(error_msg)
        
        logger.info("[PaddleOCR] OCR 객체 준비 완료 - 텍스트 추출 시작")
        print("[PaddleOCR] OCR 객체 준비 완료", file=sys.stderr)
        
        try:
            # PIL 이미지를 numpy array로 변환
            logger.debug(f"이미지 변환 시작: 크기={image.size}, 모드={image.mode}")
            if hasattr(image, "convert"):
                image_array = np.array(image.convert("RGB"))
                logger.debug(f"이미지 배열 생성 완료: shape={image_array.shape}, dtype={image_array.dtype}")
            else:
                image_array = image
                logger.debug(f"이미지 배열 사용: shape={image_array.shape if hasattr(image_array, 'shape') else 'unknown'}")
            
            # OCR 실행 및 시간 측정
            # PaddleOCR 3.x에서는 cls 파라미터가 ocr() 메서드에 직접 지원되지 않을 수 있음
            logger.info("PaddleOCR.ocr() 호출 시작...")
            start_time = time.time()
            try:
                # PaddleOCR 3.x에서는 cls 파라미터 없이 호출 시도
                result = self.ocr.ocr(image_array)
            except TypeError as te:
                # cls 파라미터가 필요하면 다시 시도 (하위 호환성)
                if "cls" in str(te).lower() or "unexpected keyword" in str(te).lower():
                    logger.warning("cls 파라미터로 재시도 중...")
                    result = self.ocr.ocr(image_array, cls=True)
                else:
                    raise
            end_time = time.time()
            processing_time = end_time - start_time
            
            # OCR 결과 구조 확인 (디버깅용)
            logger.info(f"OCR 결과 타입: {type(result)}")
            if result is not None:
                logger.info(f"OCR 결과: {result}")
                if isinstance(result, list):
                    logger.info(f"OCR 결과 길이: {len(result)}")
                    if len(result) > 0:
                        logger.info(f"OCR 결과 첫 번째 항목: {result[0]}")
                        logger.info(f"OCR 결과 첫 번째 항목 타입: {type(result[0])}")
            
            # 결과 파싱
            # PaddleOCR 3.x 결과 구조:
            # result는 리스트이며, 각 요소는 딕셔너리 형태:
            # {
            #   'rec_texts': [텍스트1, 텍스트2, ...],
            #   'rec_scores': [신뢰도1, 신뢰도2, ...],
            #   'dt_polys': [좌표1, 좌표2, ...],
            #   ...
            # }
            texts = []
            if result is not None:
                if isinstance(result, list) and len(result) > 0:
                    # 첫 번째 결과 페이지/이미지 처리
                    page_result = result[0]
                    logger.info(f"페이지 결과 타입: {type(page_result)}")
                    
                    if isinstance(page_result, dict):
                        # PaddleOCR 3.x 딕셔너리 형식
                        rec_texts = page_result.get('rec_texts', [])
                        rec_scores = page_result.get('rec_scores', [])
                        
                        logger.info(f"인식된 텍스트 수: {len(rec_texts)}")
                        logger.info(f"신뢰도 수: {len(rec_scores)}")
                        
                        if rec_texts:
                            for idx, (text, score) in enumerate(zip(rec_texts, rec_scores if rec_scores else [None] * len(rec_texts))):
                                if text and isinstance(text, str) and text.strip():
                                    texts.append(text.strip())
                                    score_str = f"{score:.3f}" if score is not None else "N/A"
                                    logger.info(f"  ✅ 텍스트 {idx+1}: '{text.strip()}' (신뢰도: {score_str})")
                                else:
                                    logger.warning(f"  ⚠️ 텍스트 {idx+1}이 비어있음: '{text}'")
                        else:
                            logger.warning("rec_texts가 비어있습니다")
                    elif isinstance(page_result, (list, tuple)):
                        # PaddleOCR 2.x 형식 (하위 호환성)
                        logger.info("PaddleOCR 2.x 형식 감지")
                        for line_idx, line in enumerate(page_result):
                            if line is None:
                                continue
                            
                            if isinstance(line, (list, tuple)) and len(line) >= 2:
                                text_info = line[1]
                                if isinstance(text_info, (list, tuple)) and len(text_info) >= 1:
                                    text = text_info[0]
                                    if text and isinstance(text, str) and text.strip():
                                        texts.append(text.strip())
                                        logger.info(f"  ✅ 텍스트 추출 (2.x 형식): '{text.strip()}'")
                    else:
                        logger.warning(f"예상치 못한 결과 형식: {type(page_result)}")
                else:
                    logger.warning(f"OCR 결과가 비어있거나 리스트가 아닙니다: {type(result)}")
            
            logger.info(f"OCR 완료: {len(texts)}개 텍스트, {processing_time:.3f}초")
            if texts:
                logger.info(f"추출된 텍스트: {texts}")
            else:
                logger.warning("추출된 텍스트가 없습니다")
            
            return texts, processing_time
            
        except Exception as e:
            logger.error(f"OCR 처리 중 오류: {e}", exc_info=True)
            logger.error(f"오류 타입: {type(e).__name__}")
            logger.error(f"오류 메시지: {str(e)}")
            # 예외를 다시 던져서 API 엔드포인트에서 처리할 수 있도록 함
            raise RuntimeError(f"OCR 처리 실패: {e}") from e

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

