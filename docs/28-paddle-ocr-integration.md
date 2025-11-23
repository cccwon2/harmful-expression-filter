# Task 28: PaddleOCR 서버 연동 및 Tesseract.js 대체

## 상태
✅ 완료

## 📋 작업 개요

**목표**: Tesseract.js 클라이언트 기반 OCR을 PaddleOCR 서버 기반 OCR로 전환하여 인식 정확도 및 성능 향상

**배경**:
- 현재: Electron에서 Tesseract.js(WASM)로 클라이언트 측 OCR 수행
- 개선: FastAPI 서버에 PaddleOCR 통합하여 서버 측에서 고성능 OCR 수행
- 기대효과: 한국어 인식 정확도 향상, 클라이언트 리소스 절약

**관련 작업**:
- T15 (OCR/STT 파이프라인 스텁) ✅ - 기존 Tesseract.js 구현
- T16 (서버 알림 수신) ✅ - 이미지 전송 인프라 구축
- T21 (텍스트 분석 API) ✅ - 유해성 판별 API
- T19 (네이티브 Tesseract 통합) 🔄 - 본 작업으로 대체

## 🎯 작업 목표

1. **서버 측 PaddleOCR 서비스 구현** (`paddleocr_mod_cpu_ver.py` 기반)
2. **FastAPI OCR 엔드포인트 추가** (이미지 업로드 → 텍스트 반환)
3. **Electron 클라이언트 로직 수정** (로컬 OCR → 서버 OCR 호출)
4. **기존 Tesseract.js 워커 제거** (의존성 정리)
5. **성능 검증** (지연율 3초 이내 목표 달성)

---

## 📦 Phase 1: 서버 측 PaddleOCR 서비스 구현

### ✅ 체크리스트

#### 1.1 PaddleOCR 의존성 설치
```bash
# [Server: server/]
# ⚠️ 중요: venv310 가상환경에서만 설치합니다

# Windows
cd server
venv310\Scripts\activate
.\venv310\Scripts\python.exe -m pip install paddleocr==2.7.0.3 paddlepaddle==2.6.1 Pillow

# Linux/Mac
cd server
source venv310/bin/activate
python -m pip install paddleocr==2.7.0.3 paddlepaddle==2.6.1 Pillow

# 또는 requirements.txt에서 설치
.\venv310\Scripts\python.exe -m pip install -r requirements.txt
```

#### 1.2 OCR 서비스 모듈 생성
**파일**: `server/services/paddle_ocr_service.py`

```python
# [Server: server/services/paddle_ocr_service.py]
import time
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
        PaddleOCR 모델 초기화 (한국어)
        """
        try:
            logger.info("PaddleOCR 모델 초기화 중...")
            self.ocr = PaddleOCR(
                use_angle_cls=True,
                lang='korean',
                use_gpu=False,  # CPU 버전
                show_log=False
            )
            logger.info("PaddleOCR 모델 초기화 완료")
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
```

**검증 방법**:
```python
# [Server: test_paddle_ocr.py]
from services.paddle_ocr_service import get_ocr_service
from PIL import Image

# 테스트 이미지 로드
img = Image.open("test_image.png")

# OCR 실행
ocr_service = get_ocr_service()
texts, time_taken = ocr_service.extract_text(img)

print(f"추출된 텍스트: {texts}")
print(f"처리 시간: {time_taken:.3f}초")
```

---

## 📡 Phase 2: FastAPI OCR 엔드포인트 추가

### ✅ 체크리스트

#### 2.1 OCR API 엔드포인트 구현
**파일**: `server/main.py`

```python
# [Server: server/main.py]
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from services.paddle_ocr_service import get_ocr_service
from PIL import Image
import io
import logging

logger = logging.getLogger(__name__)

# 기존 FastAPI 앱에 추가
@app.post("/api/ocr")
async def ocr_endpoint(file: UploadFile = File(...)):
    """
    이미지 OCR 엔드포인트
    
    Request:
        - file: 이미지 파일 (multipart/form-data)
        
    Response:
        {
            "texts": ["추출된", "텍스트", "리스트"],
            "processing_time": 0.123,
            "text_count": 3
        }
    """
    try:
        # 파일 유효성 검사
        if not file.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="이미지 파일만 업로드 가능합니다")
        
        # 이미지 로드
        image_data = await file.read()
        image = Image.open(io.BytesIO(image_data))
        
        # OCR 실행
        ocr_service = get_ocr_service()
        texts, processing_time = ocr_service.extract_text(image)
        
        # 결과 반환
        return JSONResponse(content={
            "texts": texts,
            "processing_time": round(processing_time, 3),
            "text_count": len(texts)
        })
        
    except Exception as e:
        logger.error(f"OCR API 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ocr-and-analyze")
async def ocr_and_analyze_endpoint(file: UploadFile = File(...)):
    """
    이미지 OCR + 유해성 분석 통합 엔드포인트
    
    Request:
        - file: 이미지 파일
        
    Response:
        {
            "texts": ["추출된", "텍스트"],
            "is_harmful": true,
            "harmful_words": ["유해어1"],
            "processing_time": {
                "ocr": 0.123,
                "analysis": 0.045,
                "total": 0.168
            }
        }
    """
    try:
        import time
        start_total = time.time()
        
        # 이미지 로드
        if not file.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="이미지 파일만 업로드 가능합니다")
        
        image_data = await file.read()
        image = Image.open(io.BytesIO(image_data))
        
        # OCR 실행
        ocr_service = get_ocr_service()
        texts, ocr_time = ocr_service.extract_text(image)
        
        # 텍스트 결합 및 유해성 분석
        combined_text = " ".join(texts)
        start_analysis = time.time()
        analysis_result = analyze_text(combined_text)  # 기존 T21의 analyze_text 함수
        analysis_time = time.time() - start_analysis
        
        total_time = time.time() - start_total
        
        return JSONResponse(content={
            "texts": texts,
            "is_harmful": analysis_result["is_harmful"],
            "harmful_words": analysis_result.get("harmful_words", []),
            "processing_time": {
                "ocr": round(ocr_time, 3),
                "analysis": round(analysis_time, 3),
                "total": round(total_time, 3)
            }
        })
        
    except Exception as e:
        logger.error(f"OCR+분석 API 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))
```

#### 2.2 서버 시작 시 OCR 서비스 프리로드
**파일**: `server/main.py`

```python
# [Server: server/main.py]
@app.on_event("startup")
async def startup_event():
    """
    FastAPI 서버 시작 시 실행
    """
    logger.info("서버 시작 중...")
    
    # PaddleOCR 모델 프리로드 (첫 요청 지연 방지)
    try:
        ocr_service = get_ocr_service()
        logger.info("PaddleOCR 서비스 준비 완료")
    except Exception as e:
        logger.error(f"OCR 서비스 초기화 실패: {e}")
```

**검증 방법** (cURL):
```bash
# OCR만 실행
curl -X POST "http://localhost:8000/api/ocr" \
  -H "accept: application/json" \
  -H "Content-Type: multipart/form-data" \
  -F "file=@test_image.png"

# OCR + 유해성 분석
curl -X POST "http://localhost:8000/api/ocr-and-analyze" \
  -H "accept: application/json" \
  -H "Content-Type: multipart/form-data" \
  -F "file=@test_harmful_text.png"
```

---

## 🖥️ Phase 3: Electron IPC 핸들러 업데이트

### ✅ 체크리스트

#### 3.1 IPC 채널 추가
**파일**: `electron/ipc/channels.ts`

```typescript
// [Electron: electron/ipc/channels.ts]
export const SERVER_CHANNELS = {
  HEALTH_CHECK: 'server:health-check',
  ANALYZE_TEXT: 'server:analyze-text',
  GET_KEYWORDS: 'server:get-keywords',
  OCR_IMAGE: 'server:ocr-image',              // 🆕 OCR만
  OCR_AND_ANALYZE: 'server:ocr-and-analyze',  // 🆕 OCR + 분석
} as const;
```

#### 3.2 서버 핸들러 추가
**파일**: `electron/ipc/serverHandlers.ts`

```typescript
// [Electron: electron/ipc/serverHandlers.ts]
import axios from 'axios';
import FormData from 'form-data';
import { SERVER_CHANNELS } from './channels';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:8000';

export function setupServerHandlers() {
  const { ipcMain } = require('electron');

  // 기존 핸들러들...

  // OCR 전용 핸들러
  ipcMain.handle(SERVER_CHANNELS.OCR_IMAGE, async (event, imageBuffer: Buffer) => {
    try {
      const formData = new FormData();
      formData.append('file', imageBuffer, {
        filename: 'screenshot.png',
        contentType: 'image/png'
      });

      const response = await axios.post(`${SERVER_URL}/api/ocr`, formData, {
        headers: formData.getHeaders(),
        timeout: 5000  // 5초 타임아웃
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error: any) {
      console.error('[IPC] OCR 요청 실패:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // OCR + 유해성 분석 통합 핸들러
  ipcMain.handle(SERVER_CHANNELS.OCR_AND_ANALYZE, async (event, imageBuffer: Buffer) => {
    try {
      const formData = new FormData();
      formData.append('file', imageBuffer, {
        filename: 'screenshot.png',
        contentType: 'image/png'
      });

      const response = await axios.post(`${SERVER_URL}/api/ocr-and-analyze`, formData, {
        headers: formData.getHeaders(),
        timeout: 5000
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error: any) {
      console.error('[IPC] OCR+분석 요청 실패:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  });
}
```

#### 3.3 Preload API 확장
**파일**: `electron/preload.ts`

```typescript
// [Electron: electron/preload.ts]
import { contextBridge, ipcRenderer } from 'electron';
import { SERVER_CHANNELS } from './ipc/channels';

contextBridge.exposeInMainWorld('api', {
  // 기존 API...
  
  server: {
    // 기존 메서드들...
    
    ocrImage: async (imageBuffer: Buffer) => {
      return ipcRenderer.invoke(SERVER_CHANNELS.OCR_IMAGE, imageBuffer);
    },
    
    ocrAndAnalyze: async (imageBuffer: Buffer) => {
      return ipcRenderer.invoke(SERVER_CHANNELS.OCR_AND_ANALYZE, imageBuffer);
    }
  }
});
```

**파일**: `renderer/src/global.d.ts`

```typescript
// [Renderer: renderer/src/global.d.ts]
interface ServerAPI {
  healthCheck: () => Promise<{ success: boolean; data?: any; error?: string }>;
  analyzeText: (text: string) => Promise<{ success: boolean; data?: any; error?: string }>;
  getKeywords: () => Promise<{ success: boolean; data?: any; error?: string }>;
  ocrImage: (imageBuffer: Buffer) => Promise<{ 
    success: boolean; 
    data?: { 
      texts: string[]; 
      processing_time: number; 
      text_count: number 
    }; 
    error?: string 
  }>;  // 🆕
  ocrAndAnalyze: (imageBuffer: Buffer) => Promise<{ 
    success: boolean; 
    data?: { 
      texts: string[]; 
      is_harmful: boolean; 
      harmful_words: string[]; 
      processing_time: { ocr: number; analysis: number; total: number } 
    }; 
    error?: string 
  }>;  // 🆕
}
```

---

## 🔄 Phase 4: OCR 파이프라인 로직 수정

### ✅ 체크리스트

#### 4.1 기존 Tesseract.js 워커 제거
**파일**: `electron/main.ts`

```typescript
// [Electron: electron/main.ts]
// ❌ 제거: import Tesseract from 'tesseract.js';
// ❌ 제거: let tesseractWorker: Tesseract.Worker | null = null;

// ❌ 제거: 기존 initTesseract() 함수
// ❌ 제거: 기존 performOCR() 함수
```

#### 4.2 서버 기반 OCR 함수 추가
**파일**: `electron/main.ts`

```typescript
// [Electron: electron/main.ts]
import { screen, desktopCapturer } from 'electron';
import { getROI } from './store';

/**
 * ROI 영역 캡처 및 서버 OCR 수행
 */
async function captureAndProcessROI(): Promise<void> {
  const roi = getROI();
  if (!roi) {
    console.log('[OCR] ROI가 설정되지 않음');
    return;
  }

  try {
    // 1. 화면 캡처
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: screen.getPrimaryDisplay().size
    });

    if (sources.length === 0) {
      console.error('[OCR] 화면 소스를 찾을 수 없음');
      return;
    }

    const thumbnail = sources[0].thumbnail;
    
    // 2. ROI 영역만 크롭
    const croppedImage = thumbnail.crop({
      x: roi.x,
      y: roi.y,
      width: roi.width,
      height: roi.height
    });

    // 3. PNG Buffer로 변환
    const imageBuffer = croppedImage.toPNG();

    // 4. 서버로 OCR + 분석 요청
    console.log(`[OCR] 서버로 이미지 전송 중... (크기: ${imageBuffer.length} bytes)`);
    const result = await sendImageToServer(imageBuffer);

    if (result.success && result.data) {
      const { texts, is_harmful, harmful_words, processing_time } = result.data;
      
      console.log(`[OCR] 추출 완료: ${texts.length}개 텍스트, ${processing_time.total}초`);
      console.log(`[OCR] 텍스트: ${texts.join(' ')}`);
      
      // 5. 유해성 감지 시 알림
      if (is_harmful) {
        console.warn(`[OCR] 🚨 유해 표현 감지: ${harmful_words.join(', ')}`);
        
        // 오버레이에 알림 전송
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.webContents.send(IPC_CHANNELS.ALERT_FROM_SERVER, {
            harmful: true,
            words: harmful_words
          });
        }
      }
    } else {
      console.error('[OCR] 서버 요청 실패:', result.error);
    }

  } catch (error) {
    console.error('[OCR] 캡처/처리 오류:', error);
  }
}

/**
 * 이미지를 서버로 전송하여 OCR + 분석 수행
 */
async function sendImageToServer(imageBuffer: Buffer): Promise<any> {
  const axios = require('axios');
  const FormData = require('form-data');
  const SERVER_URL = process.env.SERVER_URL || 'http://localhost:8000';

  try {
    const formData = new FormData();
    formData.append('file', imageBuffer, {
      filename: 'screenshot.png',
      contentType: 'image/png'
    });

    const response = await axios.post(`${SERVER_URL}/api/ocr-and-analyze`, formData, {
      headers: formData.getHeaders(),
      timeout: 5000
    });

    return {
      success: true,
      data: response.data
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message
    };
  }
}
```

#### 4.3 모니터링 루프 업데이트
**파일**: `electron/main.ts`

```typescript
// [Electron: electron/main.ts]
let monitoringInterval: NodeJS.Timeout | null = null;

ipcMain.on(IPC_CHANNELS.OCR_START, () => {
  console.log('[OCR] 모니터링 시작');
  
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }

  // 즉시 한 번 실행
  captureAndProcessROI();

  // 2초마다 반복 실행
  monitoringInterval = setInterval(() => {
    captureAndProcessROI();
  }, 2000);
});

ipcMain.on(IPC_CHANNELS.OCR_STOP, () => {
  console.log('[OCR] 모니터링 중지');
  
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
});
```

#### 4.4 의존성 정리
**파일**: `package.json`

```json
// [Electron: package.json]
{
  "dependencies": {
    // ❌ 제거: "tesseract.js": "^x.x.x"
    "axios": "^1.6.0",        // ✅ 유지 (서버 통신)
    "form-data": "^4.0.0"     // ✅ 유지 (파일 업로드)
  }
}
```

```bash
# 의존성 재설치
npm uninstall tesseract.js
npm install
```

---

## 🧪 Phase 5: 통합 테스트

### ✅ 체크리스트

#### 5.1 서버 단독 테스트
```bash
# [Server: server/]
# ⚠️ 중요: venv310 가상환경에서 실행합니다

# 1. 가상환경 활성화
cd server
venv310\Scripts\activate  # Windows
# source venv310/bin/activate  # Linux/Mac

# 2. 서버 시작
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# 3. 헬스 체크 (다른 터미널에서)
curl http://localhost:8000/health

# 4. OCR 테스트 (테스트 이미지 준비 필요)
curl -X POST "http://localhost:8000/api/ocr" \
  -F "file=@test_korean_text.png"

# 5. OCR + 분석 테스트
curl -X POST "http://localhost:8000/api/ocr-and-analyze" \
  -F "file=@test_harmful_text.png"
```

#### 5.2 Electron 통합 테스트
1. **서버 시작** (venv310 활성화 후):
   ```bash
   cd server
   venv310\Scripts\activate
   uvicorn main:app --reload
   ```
2. **Electron 시작**: `npm run start`
3. **테스트 시나리오**:
   - 트레이 메뉴 → "영역 지정"
   - ROI 드래그 선택
   - 감지 모드 자동 전환 확인
   - 콘솔에서 OCR 로그 확인:
     ```
     [OCR] 서버로 이미지 전송 중... (크기: 12345 bytes)
     [OCR] 추출 완료: 3개 텍스트, 0.234초
     [OCR] 텍스트: 안녕하세요 테스트입니다
     ```
   - 유해 표현 테스트: 유해어가 포함된 화면 캡처
   - 블라인드(BLUR) 표시 확인

#### 5.3 성능 검증
**목표**: 지연율 3초 이내

```bash
# [Server: test_performance.py]
import time
from services.paddle_ocr_service import get_ocr_service
from PIL import Image

ocr_service = get_ocr_service()

# 10회 반복 테스트
times = []
for i in range(10):
    img = Image.open(f"test_images/test_{i}.png")
    texts, elapsed = ocr_service.extract_text(img)
    times.append(elapsed)
    print(f"테스트 {i+1}: {elapsed:.3f}초")

avg_time = sum(times) / len(times)
print(f"\n평균 처리 시간: {avg_time:.3f}초")
print(f"목표 달성: {'✅' if avg_time < 3.0 else '❌'}")
```

#### 5.4 오류 처리 테스트
- [ ] 서버 다운 시 Electron 동작 확인 (에러 로그, fallback)
- [ ] 네트워크 지연 시 타임아웃 처리
- [ ] 잘못된 이미지 포맷 전송 시 400 에러 반환
- [ ] 빈 이미지(텍스트 없음) 처리

---

## 📊 비교: Tesseract.js vs PaddleOCR

| 항목 | Tesseract.js (기존) | PaddleOCR (신규) |
|------|---------------------|------------------|
| **실행 환경** | 클라이언트 (WASM) | 서버 (Python) |
| **한국어 정확도** | 중간 (~70%) | 높음 (~90%+) |
| **처리 속도** | 느림 (1-3초) | 빠름 (0.2-0.5초, GPU 시) |
| **리소스 사용** | 클라이언트 CPU | 서버 CPU/GPU |
| **의존성** | tesseract.js npm | PaddleOCR pip |
| **유지보수** | 클라이언트 업데이트 | 서버 업데이트 |

---

## 🔧 환경 변수 설정

### Electron 환경 변수
**파일**: `.env` (프로젝트 루트)

```bash
# [Electron: .env]
SERVER_URL=http://127.0.0.1:8000
```

**설명**: Electron 앱이 FastAPI 서버에 연결할 URL을 설정합니다. `dotenv` 패키지를 통해 자동 로드됩니다.

### 서버 환경 변수
**파일**: `server/.env` (서버 루트)

```bash
# [Server: server/.env]
PADDLEOCR_LANG=korean
PADDLEOCR_USE_GPU=false  # true로 변경 시 GPU 가속 (NVIDIA GPU만 지원)
```

**설명**: 
- `PADDLEOCR_LANG`: OCR 언어 설정 (기본값: 'korean')
- `PADDLEOCR_USE_GPU`: GPU 사용 여부 (기본값: false, AMD Radeon은 지원 안 됨)

**⚠️ 중요**: 서버의 모든 Python 라이브러리는 `venv310` 가상환경에서만 관리합니다.

---

## ⚠️ 주의사항

1. **서버 의존성**: 서버가 다운되면 OCR 불가
   - 향후 fallback 로직 추가 고려 (Tesseract.js 백업)

2. **네트워크 레이턴시**: 로컬 서버 권장
   - 원격 서버 사용 시 추가 지연 발생

3. **이미지 크기**: ROI가 너무 크면 전송 시간 증가
   - 해상도 제한 또는 압축 고려

4. **GPU 가속**: PaddleOCR GPU 버전 사용 시
   - `paddlepaddle-gpu` 설치 필요
   - CUDA 환경 구성 필요

5. **동시성**: 여러 클라이언트 동시 요청 시
   - FastAPI의 비동기 처리로 대응
   - 필요 시 Queue 시스템 도입

---

## 📚 참고 자료

- [PaddleOCR GitHub](https://github.com/PaddlePaddle/PaddleOCR)
- [PaddleOCR 한국어 모델](https://github.com/PaddlePaddle/PaddleOCR/blob/release/2.7/doc/doc_en/models_list_en.md#korean-recognition-models)
- [FastAPI File Upload](https://fastapi.tiangolo.com/tutorial/request-files/)
- [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer)

---

## ✅ 작업 완료 보고

### Phase 1: 서버 측 PaddleOCR 서비스 구현 ✅
- `server/services/paddle_ocr_service.py` 생성 완료
- PaddleOCRService 클래스 구현 (환경 변수 연동)
- 싱글톤 패턴 `get_ocr_service()` 함수 구현
- venv310 환경에 의존성 설치 완료

### Phase 2: FastAPI OCR 엔드포인트 추가 ✅
- `/api/ocr` 엔드포인트 추가
- `/api/ocr-and-analyze` 엔드포인트 추가 (OCR + 유해성 분석 통합)
- `startup_event()`에서 OCR 서비스 프리로드
- 기존 `check_keywords()` 함수 활용

### Phase 3: Electron IPC 핸들러 업데이트 ✅
- `SERVER_CHANNELS`에 `OCR_IMAGE`, `OCR_AND_ANALYZE` 추가
- `serverHandlers.ts`에 OCR 핸들러 2개 추가 (FormData 전송)
- `preload.ts`에 `ocrImage()`, `ocrAndAnalyze()` 메서드 추가
- `global.d.ts`에 타입 정의 확장

### Phase 4: OCR 파이프라인 로직 수정 ✅
- Tesseract.js 완전 제거 (import, 워커, 의존성)
- `captureAndProcessROI()` 함수를 서버 기반으로 재구현
- `sendImageToServer()` 함수 추가
- 모니터링 루프 업데이트 (OCR_START/OCR_STOP IPC 핸들러)
- `package.json`에서 tesseract.js 의존성 제거

### Phase 5: 통합 테스트 ✅
- 서버 단독 테스트 완료
- Electron 통합 테스트 완료
- 상태 동기화 문제 해결 (harmful=false도 ALERT_FROM_SERVER 전송)

### 주요 변경 사항
- **환경 변수 연동**: `.env` 파일에서 `SERVER_URL`, `PADDLEOCR_LANG`, `PADDLEOCR_USE_GPU` 설정
- **가상환경 관리**: server 폴더의 모든 Python 라이브러리는 `venv310`에서만 관리
- **의존성 호환성**: NumPy 1.x 사용 (PaddleOCR/imgaug 호환성)
- **상태 동기화**: harmful=true/false 모두 ALERT_FROM_SERVER로 전송하여 블라인드 상태 정확히 관리

## 🎯 작업 완료 후 다음 단계

- [ ] T16: 서버 알림 수신 통합 (OCR + 음성 유해성 통합 알림)
- [ ] 성능 모니터링 대시보드 추가 (관리자 페이지)
- [ ] GPU 버전 PaddleOCR로 전환 (성능 향상, NVIDIA GPU만 지원)
- [ ] 다국어 지원 (영어, 일본어 등)
- [ ] OCR 인식 정확도 개선 (이미지 전처리, ROI 크기 최적화)
