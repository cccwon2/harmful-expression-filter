# Task 51: PaddleOCR 전환, 사용자 대시보드 통합 및 UUID 기반 사용자 식별

## 상태

✅ 완료

## 📋 작업 개요

**목표**: 서버 측 PaddleOCR 완전 전환, 사용자 대시보드 통합, UUID 기반 사용자 식별 시스템 구축

**배경**:
- Windows SDK OCR에서 서버 측 PaddleOCR로 완전 전환 완료
- 사용자 대시보드 접근성 향상 및 UUID를 통한 사용자 식별 필요
- `detection_logs` 테이블에 `user_id` 저장이 누락되는 문제 해결

**주요 변경 사항**:
1. ✅ Windows SDK OCR 완전 제거, 서버 측 PaddleOCR로 전환
2. ✅ 트레이 메뉴에 사용자 대시보드 바로가기 추가
3. ✅ UUID 기반 사용자 식별 시스템 구축
4. ✅ HTTP Header를 통한 `user_id` 전달 및 저장
5. ✅ UUID 영구 저장 로직 개선 (store.ts 통합)

**관련 작업**:
- Task 28 (PaddleOCR 서버 연동) ✅ - 서버 측 PaddleOCR 구현
- Task 34 (Windows OCR 성능 최적화) ⚠️ - 레거시 (현재 미사용)
- Task 44 (Vercel 관리자 대시보드) 📝 - 대시보드 프로젝트
- Task 46 (Supabase Admin DB) ✅ - detection_logs 테이블

---

## 🎯 구현 목표

### Phase 1: Windows SDK OCR 완전 제거 및 PaddleOCR 전환 ✅

1. **Electron 클라이언트 OCR 전환**
   - Windows SDK OCR 호출 제거
   - 서버 측 PaddleOCR API 호출로 변경
   - 모든 OCR 요청을 `/api/ocr` 및 `/api/ocr-and-analyze` 엔드포인트로 전환

2. **서버 측 PaddleOCR 서비스 활성화**
   - `server/services/paddle_ocr_service.py` 서비스 활성화
   - FastAPI 엔드포인트에서 PaddleOCR 사용
   - CPU/GPU 버전 모두 지원

### Phase 2: 사용자 대시보드 통합 ✅

1. **트레이 메뉴 대시보드 바로가기 추가**
   - 트레이 메뉴에 "사용자 대시보드" 메뉴 항목 추가
   - Electron BrowserWindow를 통한 대시보드 창 관리
   - URL: `https://admin-dashboard-pi-seven-83.vercel.app/`

2. **대시보드 창 관리**
   - 별도 세션 파티션 사용 (`persist:dashboard-${deviceId}`)
   - HTTP Header에 UUID 자동 포함
   - 창 생명주기 관리 (닫기, 최소화, 복원)

### Phase 3: UUID 기반 사용자 식별 시스템 ✅

1. **UUID 영구 저장 로직 개선**
   - 별도 파일 저장 방식 제거
   - 기존 `store.ts` 저장소 시스템 활용
   - 앱 재시작 후에도 동일한 UUID 유지

2. **HTTP Header를 통한 UUID 전달**
   - 모든 서버 요청에 `user-id` Header 추가
   - Electron에서 자동으로 UUID 생성 및 전달
   - 서버에서 Header를 읽어 `detection_logs` 테이블에 저장

3. **서버 측 Header 처리 개선**
   - FastAPI Request 객체에서 Header 읽기
   - 여러 Header 이름 변형 지원 (`user-id`, `user_id` 등)
   - 디버깅 로그 추가

---

## 📦 의존성

### 필수 작업
- ✅ Task 28: PaddleOCR 서버 연동
- ✅ Task 46: Supabase Admin DB
- ✅ Task 44: Vercel 관리자 대시보드 (협업)

### 필수 패키지
```json
{
  "dependencies": {
    "uuid": "^9.0.1",
    "axios": "^1.13.2"
  }
}
```

---

## 🗂️ 파일 구조

작업 완료 후 다음과 같은 파일들이 생성/수정되었습니다:

```
프로젝트루트/
├── electron/
│   ├── store.ts                          # ✅ deviceId 필드 추가
│   ├── utils/
│   │   └── deviceId.ts                   # ✅ store.ts 활용으로 단순화
│   ├── windows/
│   │   └── createDashboardWindow.ts      # 🆕 대시보드 창 관리
│   ├── ipc/
│   │   └── serverHandlers.ts             # ✅ Header에 user-id 추가
│   ├── tray.ts                           # ✅ 대시보드 메뉴 항목 추가
│   └── main.ts                           # ✅ Header에 user-id 추가
├── server/
│   ├── main.py                           # ✅ Header에서 user_id 읽기
│   ├── db/
│   │   └── supabase_client.py            # ✅ user_id 저장 로직 개선
│   └── services/
│       └── paddle_ocr_service.py         # ✅ 서버 측 PaddleOCR 활성화
└── docs/
    └── 51-paddleocr-dashboard-userid-integration.md  # 🆕 이 문서
```

---

## 🔧 주요 구현 내용

### 1. UUID 영구 저장 시스템 개선

#### 문제점
- 기존 `deviceId.ts`는 별도 파일(`device-uuid.json`)에 저장
- 앱 재시작 시 UUID가 매번 새로 생성되는 문제 발생
- 저장소 시스템이 분산되어 관리 어려움

#### 해결 방법
- 기존 `store.ts` 저장소 시스템 활용
- `StoreData` 인터페이스에 `deviceId?: string` 필드 추가
- `getOrCreateDeviceId()` 함수 구현 (최초 1회만 생성)

#### 구현 코드

```typescript
// electron/store.ts
export interface StoreData {
  // ... 기존 필드들
  deviceId?: string; // 디바이스 UUID (최초 1회 생성 후 영구 저장)
}

export function getOrCreateDeviceId(): string {
  const data = loadData();
  
  // 이미 저장된 UUID가 있으면 반환
  if (data.deviceId && typeof data.deviceId === 'string' && data.deviceId.length > 0) {
    console.log('[Store] 기존 디바이스 UUID 로드:', data.deviceId);
    return data.deviceId;
  }
  
  // 없으면 새로 생성하여 저장
  const newId = uuidv4();
  data.deviceId = newId;
  saveData(data);
  console.log('[Store] ✅ 새로운 디바이스 UUID 생성 및 저장:', newId);
  
  return newId;
}
```

```typescript
// electron/utils/deviceId.ts
import { getOrCreateDeviceId } from '../store';

export function getDeviceId(): string {
  return getOrCreateDeviceId();
}
```

#### 동작 방식

```
첫 번째 실행:
  getDeviceId() → UUID 생성 → store.json에 저장 → 반환

두 번째 실행 이후:
  getDeviceId() → store.json에서 읽기 → 동일한 UUID 반환 ✅
```

---

### 2. HTTP Header를 통한 UUID 전달

#### Electron 클라이언트 측

**모든 서버 요청에 `user-id` Header 추가**:

```typescript
// electron/ipc/serverHandlers.ts
// /analyze 요청
const { getDeviceId } = require("../utils/deviceId");
const deviceId = getDeviceId();
const headers = {
  "Content-Type": "application/json",
  "user-id": userId || deviceId,  // HTTP 표준: 하이픈 사용
};

// /api/ocr-and-analyze 요청
const headers = {
  ...formData.getHeaders(),
  "user-id": deviceId,  // HTTP 표준: 하이픈 사용
};
```

```typescript
// electron/main.ts
// sendImageToServer 함수
const { getDeviceId } = require("./utils/deviceId");
const deviceId = getDeviceId();
const headers = {
  ...formData.getHeaders(),
  "user-id": deviceId,
};
```

#### 서버 측

**FastAPI Request 객체에서 Header 읽기**:

```python
# server/main.py
@app.post("/analyze")
async def analyze_text(
    request: AnalyzeRequest,
    background_tasks: BackgroundTasks,
    http_request: Request,  # Header에서 user_id 가져오기 위해
    threshold: Optional[float] = Query(None)
):
    if classifier:
        # 여러 변형으로 Header 확인
        all_headers_dict = dict(http_request.headers)
        user_id_from_header = None
        
        for key_variant in ["user-id", "user_id", "User-Id", "USER_ID"]:
            if key_variant in all_headers_dict:
                user_id_from_header = all_headers_dict[key_variant]
                break
        
        user_id = user_id_from_header or request.user_id
        
        # DB 저장
        background_tasks.add_task(
            save_detection_log,
            # ...
            user_id=user_id,
        )
```

```python
# server/main.py
@app.post("/api/ocr-and-analyze")
async def ocr_and_analyze_endpoint(
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    http_request: Request,
    threshold: Optional[float] = Query(None)
):
    if is_harmful and classifier:
        # Header에서 user_id 가져오기
        user_id = None
        if http_request:
            all_headers_dict = dict(http_request.headers)
            for key_variant in ["user-id", "user_id", "User-Id", "USER_ID"]:
                if key_variant in all_headers_dict:
                    user_id = all_headers_dict[key_variant]
                    break
        
        background_tasks.add_task(
            save_detection_log,
            # ...
            user_id=user_id,
        )
```

---

### 3. 사용자 대시보드 통합

#### 트레이 메뉴에 대시보드 바로가기 추가

```typescript
// electron/tray.ts
{
  type: 'separator',
},
{
  label: '--- 사용자 대시보드 ---',
  enabled: false,
},
{
  label: '대시보드 열기',
  type: 'normal',
  click: () => {
    const { openDashboardWindow } = require('./windows/createDashboardWindow');
    openDashboardWindow();
  },
},
```

#### 대시보드 창 관리

```typescript
// electron/windows/createDashboardWindow.ts
import { BrowserWindow, session } from 'electron';
import { getDeviceId } from '../utils/deviceId';

const DASHBOARD_URL = 'https://admin-dashboard-pi-seven-83.vercel.app/';

export function openDashboardWindow(): void {
  // 이미 창이 열려있으면 포커스만 이동
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    if (dashboardWindow.isMinimized()) {
      dashboardWindow.restore();
    }
    dashboardWindow.focus();
    return;
  }

  // 디바이스 UUID 가져오기
  const deviceId = getDeviceId();
  console.log('[Dashboard] 디바이스 UUID:', deviceId);

  // 새로운 세션 생성 (기본 세션과 분리하여 Header 추가)
  const partition = `persist:dashboard-${deviceId}`;
  const dashboardSession = session.fromPartition(partition);

  // 모든 HTTP 요청에 Header 추가
  dashboardSession.webRequest.onBeforeSendHeaders(
    {
      urls: ['*://*/*'], // 모든 URL
    },
    (details, callback) => {
      // 대시보드 URL에만 Header 추가
      if (details.url.startsWith(DASHBOARD_URL) || 
          details.url.includes('vercel.app') || 
          details.url.includes('admin-dashboard')) {
        details.requestHeaders['user_id'] = deviceId;
        console.log('[Dashboard] Header 추가:', { url: details.url, user_id: deviceId });
      }
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  // 대시보드 창 생성
  dashboardWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: '#ffffff',
    title: '사용자 대시보드',
    webPreferences: {
      session: dashboardSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 창이 닫히면 참조 제거
  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
  });

  // 로드 완료 후 표시
  dashboardWindow.webContents.once('did-finish-load', () => {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.show();
      console.log('[Dashboard] 대시보드 창 열림:', DASHBOARD_URL);
    }
  });

  // 대시보드 URL 로드
  dashboardWindow.loadURL(DASHBOARD_URL);
}
```

---

### 4. 서버 측 DB 저장 로직 개선

#### Supabase 저장 함수 개선

```python
# server/db/supabase_client.py
async def save_detection_log(
    text: str,
    confidence: float,
    threshold: float,
    model: str,
    is_harmful: bool,
    user_id: str = None,
    filter_mode: str | None = None,
):
    if not supabase:
        return
    
    try:
        data = {
            "text_content": text,
            "confidence": confidence,
            "threshold_used": threshold,
            "model_version": model,
            "is_harmful": is_harmful,
            "filter_mode": filter_mode,
        }
        
        # user_id가 있으면 추가 (None이면 제외)
        if user_id:
            data["user_id"] = user_id
        
        LOGGER.info(f"📝 Supabase 로그 저장: user_id={user_id}, text={text[:30]}..., is_harmful={is_harmful}")
        
        result = supabase.table("detection_logs").insert(data).execute()
        LOGGER.debug(f"✅ Log saved to Supabase: {text[:10]}...")
    except Exception as e:
        LOGGER.error(f"❌ Failed to save log to Supabase: {e}", exc_info=True)
```

---

## 🐛 문제 해결

### 문제 1: UUID가 매번 새로 생성됨

**증상**: 앱을 재시작할 때마다 다른 UUID가 생성되어 `user_id`가 일관되지 않음

**원인**: 별도 파일에 저장하던 UUID가 제대로 로드되지 않거나, 저장 로직에 문제가 있었음

**해결**: 기존 `store.ts` 저장소 시스템에 통합하여 영구 저장 보장

### 문제 2: user_id가 null로만 저장됨

**증상**: `detection_logs` 테이블에 `user_id`가 항상 `null`로 저장됨

**원인**: 
1. HTTP Header에 UUID가 전송되지 않음
2. 서버에서 Header를 읽지 못함
3. Header 이름 불일치 (`user_id` vs `user-id`)

**해결**:
1. Electron에서 모든 서버 요청에 `user-id` Header 추가
2. 서버에서 여러 Header 이름 변형 지원 (`user-id`, `user_id` 등)
3. 디버깅 로그 추가하여 Header 전송/수신 확인

### 문제 3: Windows SDK OCR과 PaddleOCR 혼재

**증상**: 일부 코드에서 여전히 Windows SDK OCR을 사용

**원인**: 전환 작업이 완전하지 않음

**해결**: 모든 Windows SDK OCR 호출을 서버 측 PaddleOCR로 변경

### 문제 4: 빈 텍스트가 DB에 저장됨

**증상**: voice 모드에서 빈 텍스트(`text_content = ''`)가 DB에 저장됨

**원인**: STT 결과가 빈 문자열이거나 공백만 있는 경우에도 DB 저장 로직이 실행됨

**해결**: 
1. `_check_harmful_async` 메서드에서 `transcript.strip()` 체크 추가
2. `/analyze` 엔드포인트에서 `request.text.strip()` 체크 추가
3. `/api/ocr-and-analyze` 엔드포인트에서 `combined_text.strip()` 체크 추가
4. `_save_detection_log_async` 메서드에서 이중 체크로 안전성 보장
5. 빈 텍스트는 로그만 남기고 DB 저장을 건너뜀

### 문제 5: filter_mode가 잘못 저장됨

**증상**: voice 모드인데도 `filter_mode`가 `'ocr'`로 저장됨

**원인**: `DeepgramWebSocketManager`에서 `filter_mode`를 명시적으로 설정하지 않음

**해결**: 
1. `DeepgramWebSocketManager` 초기화 시 `filter_mode="voice"` 명시
2. `/api/ocr-and-analyze` 엔드포인트에서 `filter_mode="ocr"` 명시
3. `/analyze` 엔드포인트에서 `request.filter_mode` 또는 기본값 `"ocr"` 사용

### 문제 6: user_id가 null로 저장됨 (voice 모드)

**증상**: voice 모드에서 `user_id`가 `null`로 저장됨

**원인**: WebSocket 헤더에서 UUID를 읽지 못함

**해결**:
1. WebSocket 연결 시 헤더에 `uuid`, `user-id`, `user_id` 등 여러 변형으로 전송
2. 서버에서 여러 Header 이름 변형 지원 (대소문자 무시)
3. `DeepgramWebSocketManager`에 `user_id` 파라미터 전달
4. 디버깅 로그 추가하여 Header 전송/수신 확인

---

## 📊 디버깅 및 모니터링

### 로그 확인 포인트

#### Electron 로그
```
[Store] ✅ 새로운 디바이스 UUID 생성 및 저장: <UUID>
[IPC] 📤 Header에 user-id 추가: <UUID>
[OCR] 📤 Header에 user-id 추가: <UUID>
[Dashboard] 디바이스 UUID: <UUID>
```

#### 서버 로그
```
[Analyze] 🔍 user_id 추출: Header=<UUID>, Request Body=..., 최종=<UUID>
[OCR+Analyze] 🔍 user_id 추출: Header=<UUID>
📝 Supabase 로그 저장: user_id=<UUID>, text=..., is_harmful=True
✅ Log saved to Supabase: ...
```

#### Header를 찾지 못한 경우
```
[Analyze] ⚠️ Header에서 user_id를 찾을 수 없습니다. 사용 가능한 헤더: [...]
[OCR+Analyze] ⚠️ Header에서 user_id를 찾을 수 없습니다. 사용 가능한 헤더: [...]
```

---

## ✅ 작업 완료 체크리스트

### Phase 1: Windows SDK OCR 완전 제거 ✅
- [x] Electron에서 Windows SDK OCR 호출 제거
- [x] 서버 측 PaddleOCR로 모든 OCR 요청 전환
- [x] `/api/ocr` 및 `/api/ocr-and-analyze` 엔드포인트 활성화
- [x] PaddleOCR 서비스 초기화 및 프리로드

### Phase 2: 사용자 대시보드 통합 ✅
- [x] 트레이 메뉴에 "사용자 대시보드" 메뉴 항목 추가
- [x] `createDashboardWindow.ts` 파일 생성
- [x] 대시보드 창 관리 (생성, 닫기, 최소화, 복원)
- [x] 별도 세션 파티션 사용
- [x] HTTP Header에 UUID 자동 포함

### Phase 3: UUID 기반 사용자 식별 시스템 ✅
- [x] `store.ts`에 `deviceId` 필드 추가
- [x] `getOrCreateDeviceId()` 함수 구현
- [x] `deviceId.ts` 단순화 (store.ts 활용)
- [x] 모든 서버 요청에 `user-id` Header 추가
- [x] 서버에서 Header 읽기 로직 구현
- [x] 여러 Header 이름 변형 지원
- [x] `detection_logs` 테이블에 `user_id` 저장
- [x] 디버깅 로그 추가

### Phase 4: 데이터 품질 개선 ✅
- [x] 빈 텍스트 필터링 (voice 모드)
- [x] 빈 텍스트 필터링 (OCR 모드)
- [x] 빈 텍스트 필터링 (`/analyze` 엔드포인트)
- [x] `filter_mode` 정확한 저장 (voice/ocr 구분)
- [x] WebSocket 헤더에서 UUID 읽기 개선
- [x] 모든 분석 결과 저장 (유해/정상 구분 없이)

---

## 🎯 다음 단계

### 향후 개선 사항

1. **대시보드 인증 시스템**
   - UUID 기반 사용자 인증
   - 세션 관리 개선

2. **사용자 관리 기능**
   - 여러 기기에서 동일 사용자 인식
   - 사용자별 통계 및 리포트

3. **로그 분석**
   - 사용자별 감지 로그 분석
   - 시간대별/기기별 패턴 분석

4. **알림 시스템**
   - 사용자별 알림 설정
   - 실시간 알림 전송

---

## 📚 관련 문서

- [Task 28: PaddleOCR 서버 연동](./28-paddle-ocr-integration.md) - PaddleOCR 구현 상세
- [Task 44: Vercel 관리자 대시보드](./44-vercel-admin-dashboard.md) - 대시보드 협업 가이드
- [Task 46: Supabase Admin DB](./46-supabase-admin-db.md) - DB 스키마 및 API
- [Task 34: Windows OCR 성능 최적화](./34-windows-ocr-optimization.md) - 레거시 문서
- [Task 49: 유해 표현 블라인드 처리](./49-harmful-content-blind-ocr-continuous.md) - 블라인드 최적화와의 호환성

---

## 🔍 주요 변경 파일 목록

### 수정된 파일
- `electron/store.ts` - deviceId 필드 및 함수 추가
- `electron/utils/deviceId.ts` - store.ts 활용으로 단순화
- `electron/ipc/serverHandlers.ts` - Header에 user-id 추가
- `electron/main.ts` - Header에 user-id 추가
- `electron/tray.ts` - 대시보드 메뉴 항목 추가
- `electron/windows/createDashboardWindow.ts` - UUID 헤더 전달 로직 개선
- `server/main.py` - Header에서 user_id 읽기, 빈 텍스트 필터링, filter_mode 저장 개선
- `server/db/supabase_client.py` - user_id 저장 로직 개선

### 새로 생성된 파일
- `electron/windows/createDashboardWindow.ts` - 대시보드 창 관리
- `docs/51-paddleocr-dashboard-userid-integration.md` - 이 문서

---

## 🎉 완료

이 작업을 통해 다음을 달성했습니다:

1. ✅ **서버 측 PaddleOCR 완전 전환**: Windows SDK OCR 의존성 제거
2. ✅ **사용자 대시보드 통합**: 트레이 메뉴에서 쉽게 접근 가능
3. ✅ **UUID 기반 사용자 식별**: 앱 재시작 후에도 동일한 UUID 유지
4. ✅ **정확한 사용자 로그**: `detection_logs` 테이블에 `user_id` 정확히 저장
5. ✅ **데이터 품질 개선**: 빈 텍스트 필터링, `filter_mode` 정확한 저장
6. ✅ **디버깅 기능 강화**: 상세한 로그로 문제 추적 용이

---

**작성일**: 2025-01-XX  
**상태**: ✅ 완료  
**작업자**: AI Assistant

