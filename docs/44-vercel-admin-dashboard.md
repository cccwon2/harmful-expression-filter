# Task 44: Vercel 관리자 대시보드 구축 (협업 가이드)

## 상태

🚀 진행 중 (협업 모드)

## 📋 작업 개요

팀원(Frontend Developer)이 **Next.js**를 사용하여 관리자 대시보드를 구축하고, **FastAPI 서버**는 이에 필요한 API를 제공하는 협업 구조에 대한 명세서입니다.

**목표**:

1. **Backend (본인)**: 대시보드가 접근할 수 있도록 API 개방 (CORS) 및 명세 제공
2. **Frontend (팀원)**: Next.js로 UI 구현 및 Vercel 배포
3. **통합**: 원격 관리 시스템 구축 (로그 조회, 민감도 설정 등)

**배경**:

- 현재 FastAPI 서버(`server/main.py`)는 로컬 또는 원격 서버에서 실행 중
- 서버 상태 확인, 텍스트 분석 테스트, 설정 변경 등을 웹 UI로 관리하고 싶음
- Vercel은 Next.js와 최적 통합되어 있으며 무료 티어로 충분히 운영 가능
- 관리자 대시보드를 별도 프로젝트로 분리하여 독립적으로 배포 및 관리

**관련 작업**:

- Task 20 (FastAPI 기본 구조) ✅ - 서버 API 엔드포인트
- Task 21 (텍스트 분석 API) ✅ - `/analyze` 엔드포인트
- Task 43 (Threshold 설정) ✅ - Threshold 구성 방법
- Task 46 (Supabase Admin DB) ✅ - API 엔드포인트 구현 완료

## 🏗️ 협업 아키텍처

프론트엔드는 데이터베이스(Supabase)에 직접 접근하지 않고, **오직 FastAPI 서버와 통신**합니다. 보안 키 관리와 비즈니스 로직을 백엔드에서 중앙 관리하기 위함입니다.

```
┌─────────────────────────────────────────┐
│   관리자 (User)                          │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│   Next.js Dashboard                     │
│   (Team Member - Frontend)              │
│   - Vercel 배포                         │
│   - React/Next.js                        │
└─────────────────┬───────────────────────┘
                  │ REST API
                  │ (CORS 허용)
                  ▼
┌─────────────────────────────────────────┐
│   FastAPI Server                        │
│   (Backend - You)                       │
│   - /health                             │
│   - /admin/logs                         │
│   - /admin/sync-settings                │
│   - /analyze                            │
└────────┬────────────────────────────────┘
         │
         ├──► Supabase (PostgreSQL)
         │    - detection_logs
         │    - app_settings
         │
         └──► AI Models
              - KoElectra / Kanana
```

**중요 원칙**:

- ✅ 프론트엔드는 **FastAPI 서버만** 호출
- ❌ 프론트엔드는 **Supabase에 직접 접근하지 않음** (보안)
- ✅ 모든 비즈니스 로직은 백엔드에서 처리

## 🧑‍💻 Backend 준비 사항

팀원이 개발을 시작하기 전에 다음 사항들을 서버에 적용해야 합니다.

### 1. CORS 설정 (필수)

`server/main.py`에서 프론트엔드 개발 서버(`localhost:3000`)의 접근을 허용해야 합니다.

**현재 설정 확인**:

```python
# server/main.py
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 현재는 모든 도메인 허용 (개발용)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**프로덕션 환경 권장 설정**:

```python
# server/main.py
import os

# 환경 변수에서 허용된 도메인 목록 읽기
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,https://your-dashboard.vercel.app"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,  # 특정 도메인만 허용
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**개발 단계에서는 `allow_origins=["*"]`로 두어도 무방하지만, 프로덕션 배포 전에는 반드시 특정 도메인만 허용하도록 변경하세요.**

### 2. 제공되는 API 목록

팀원에게 다음 엔드포인트가 준비되었음을 알려주세요. (상세 명세는 `/docs` 참고)

| 기능            | Method | Endpoint               | 설명                                     |
| :-------------- | :----- | :--------------------- | :--------------------------------------- |
| **서버 상태**   | `GET`  | `/health`              | 서버 상태, 모델 정보 확인                |
| **로그 조회**   | `GET`  | `/admin/logs`          | 감지된 유해 표현 로그 목록 (페이징 지원) |
| **설정 변경**   | `POST` | `/admin/sync-settings` | 민감도(Threshold) 등 설정 값 실시간 변경 |
| **텍스트 분석** | `POST` | `/analyze`             | (테스트용) 텍스트 유해성 분석            |

### 3. API 상세 명세

#### A. 서버 상태 확인

**Endpoint**: `GET /health`

**응답 예시**:

```json
{
  "status": "ok",
  "stt_service": "Deepgram (nova-2)",
  "ai_model": "KoElectra",
  "mode": "Integrated Filter",
  "threshold": 0.5,
  "threshold_source": "app_state"
}
```

#### B. 로그 조회

**Endpoint**: `GET /admin/logs`

**Query Parameters**:

- `limit` (optional, default: 20): 가져올 로그 개수 (1-100)
- `offset` (optional, default: 0): 시작 위치 (페이징용)
- `only_harmful` (optional, default: false): 유해한 것만 조회

**예시 요청**:

```bash
GET /admin/logs?limit=20&offset=0&only_harmful=false
```

**응답 예시**:

```json
{
  "count": 2,
  "logs": [
    {
      "id": 15,
      "created_at": "2025-11-29T14:05:20.317164+00:00",
      "text_content": "욕설",
      "confidence": 0.5114,
      "threshold_used": 0.5,
      "model_version": "KoElectra",
      "is_harmful": true,
      "user_id": null,
      "metadata": {}
    },
    {
      "id": 14,
      "created_at": "2025-11-29T13:45:10.123456+00:00",
      "text_content": "안녕하세요",
      "confidence": 0.1234,
      "threshold_used": 0.5,
      "model_version": "KoElectra",
      "is_harmful": false,
      "user_id": null,
      "metadata": {}
    }
  ]
}
```

#### C. 설정 변경

**Endpoint**: `POST /admin/sync-settings`

**Request Body**:

```json
{
  "key": "threshold_koelectra",
  "value": "0.6"
}
```

**응답 예시**:

```json
{
  "status": "updated",
  "key": "threshold_koelectra",
  "new_value": "0.6"
}
```

**주의사항**:

- `key`는 `threshold_koelectra` 또는 `threshold_kanana`만 지원
- `value`는 문자열 형태로 전달 (예: `"0.6"`)
- 현재는 인증이 없어서 누구나 호출 가능 (Task 47에서 보안 강화 예정)

#### D. 텍스트 분석 (테스트용)

**Endpoint**: `POST /analyze`

**Request Body**:

```json
{
  "text": "분석할 텍스트"
}
```

**Query Parameters** (선택사항):

- `threshold` (optional): 임시 threshold 값 (0.0-1.0)

**응답 예시**:

```json
{
  "has_violation": false,
  "ai_analysis": {
    "is_harmful": false,
    "confidence": 0.1234,
    "threshold_used": 0.5
  }
}
```

### 4. Swagger UI 제공

개발 중 API 테스트를 위해 Swagger UI를 제공합니다:

- **URL**: `http://localhost:8000/docs` (서버 실행 시)
- 팀원이 직접 API를 테스트하고 응답 형식을 확인할 수 있습니다

---

## 🎨 Frontend 개발 가이드 (팀원 전달용)

> **팀원분께 전달할 개발 명세서입니다.**

### 1. 프로젝트 개요

- **Framework**: Next.js (App Router 권장)
- **Styling**: Tailwind CSS (권장)
- **Deployment**: Vercel
- **API 통신**: Fetch API 또는 Axios

### 2. 프로젝트 초기화

#### Next.js 프로젝트 생성

```bash
# 새 폴더 생성 (프로젝트 루트와 별도)
cd ..
mkdir admin-dashboard
cd admin-dashboard

# Next.js 프로젝트 생성
npx create-next-app@latest . --typescript --tailwind --app --no-git

# 또는 빈 폴더에서 시작
npx create-next-app@latest admin-dashboard --typescript --tailwind --app
```

#### 의존성 설치

```bash
# 기본 의존성
npm install axios

# UI 라이브러리 (선택사항)
npm install lucide-react          # 아이콘
npm install recharts              # 차트/그래프
npm install @tanstack/react-query # 데이터 fetching 관리
```

### 3. 환경 변수 설정

프로젝트 루트에 `.env.local` 파일을 생성하고 백엔드 API 주소를 설정하세요.

```env
# 로컬 개발 시 (백엔드 서버가 켜져 있어야 함)
NEXT_PUBLIC_API_URL=http://localhost:8000
```

**주의**: Next.js에서는 환경 변수에 `NEXT_PUBLIC_` 접두사가 필수입니다.

`.env.example` 파일 (Git에 커밋):

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 4. API 클라이언트 구현

`lib/api.ts` 파일 생성:

```typescript
// lib/api.ts
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ============== 타입 정의 ==============

export interface HealthResponse {
  status: string;
  stt_service: string;
  ai_model: string;
  mode: string;
  threshold?: number;
  threshold_source?: string;
}

export interface DetectionLog {
  id: number;
  created_at: string;
  text_content: string;
  confidence: number;
  threshold_used: number;
  model_version: string;
  is_harmful: boolean;
  user_id: string | null;
  metadata: Record<string, any>;
}

export interface LogsResponse {
  count: number;
  logs: DetectionLog[];
}

export interface SyncSettingsRequest {
  key: string;
  value: string;
}

export interface SyncSettingsResponse {
  status: string;
  key: string;
  new_value: string;
}

export interface AnalyzeRequest {
  text: string;
}

export interface AnalyzeResponse {
  has_violation: boolean;
  ai_analysis: {
    is_harmful: boolean;
    confidence: number;
    threshold_used: number;
  } | null;
}

// ============== API 함수 ==============

/**
 * 서버 상태 확인
 */
export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_URL}/health`);
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.statusText}`);
  }
  return response.json();
}

/**
 * 감지 로그 조회
 */
export async function fetchLogs(
  limit: number = 20,
  offset: number = 0,
  onlyHarmful: boolean = false
): Promise<LogsResponse> {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
    only_harmful: onlyHarmful.toString(),
  });

  const response = await fetch(`${API_URL}/admin/logs?${params}`);
  if (!response.ok) {
    throw new Error(`Logs fetch failed: ${response.statusText}`);
  }
  return response.json();
}

/**
 * 설정 변경 (Threshold 등)
 */
export async function syncSettings(key: string, value: string): Promise<SyncSettingsResponse> {
  const response = await fetch(`${API_URL}/admin/sync-settings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ key, value }),
  });

  if (!response.ok) {
    throw new Error(`Settings sync failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * 텍스트 분석 (테스트용)
 */
export async function analyzeText(text: string, threshold?: number): Promise<AnalyzeResponse> {
  const params = threshold !== undefined ? `?threshold=${threshold}` : "";

  const response = await fetch(`${API_URL}/analyze${params}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Analysis failed: ${response.statusText}`);
  }

  return response.json();
}
```

### 5. 주요 기능 명세

#### A. 대시보드 메인 (Status Dashboard)

서버가 살아있는지 확인하고 현재 구동 중인 모델 정보를 표시합니다.

**API**: `GET /health`

**표시할 정보**:

- Status (OK/Error) - 상태 배지
- AI Model Name - 현재 사용 중인 모델
- STT Service - 음성 인식 서비스
- Mode - 필터 모드
- Current Threshold (현재 민감도) - 숫자 표시

**구현 예시**: `components/DashboardStats.tsx`

```typescript
"use client";

import { useEffect, useState } from "react";
import { fetchHealth, type HealthResponse } from "@/lib/api";

export function DashboardStats() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadHealth = async () => {
      try {
        setLoading(true);
        const data = await fetchHealth();
        setHealth(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    loadHealth();

    // 30초마다 자동 갱신
    const interval = setInterval(loadHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div className="text-red-500">Error: {error}</div>;
  }

  if (!health) {
    return null;
  }

  return (
    <div className="p-4 border rounded-lg">
      <h2 className="text-xl font-bold mb-4">서버 상태</h2>
      <div className="space-y-2">
        <div>
          <span className="font-semibold">상태: </span>
          <span className={health.status === "ok" ? "text-green-500" : "text-red-500"}>
            {health.status === "ok" ? "🟢 Online" : "🔴 Offline"}
          </span>
        </div>
        <div>
          <span className="font-semibold">AI 모델: </span>
          {health.ai_model}
        </div>
        <div>
          <span className="font-semibold">STT 서비스: </span>
          {health.stt_service}
        </div>
        <div>
          <span className="font-semibold">모드: </span>
          {health.mode}
        </div>
        {health.threshold !== undefined && (
          <div>
            <span className="font-semibold">현재 민감도: </span>
            {health.threshold}
          </div>
        )}
      </div>
    </div>
  );
}
```

#### B. 감지 로그 뷰어 (Log Viewer)

유해 표현이 감지된 이력을 테이블 형태로 보여줍니다.

**API**: `GET /admin/logs?limit=20&offset=0`

**UI 요구사항**:

- 테이블 컬럼: 시간(`created_at`), 텍스트(`text_content`), 유해 여부(`is_harmful`), 신뢰도(`confidence`), 모델(`model_version`)
- (선택사항) '유해한 것만 보기' 필터 (`only_harmful=true`)
- (선택사항) 더보기/페이지네이션 기능

**구현 예시**: `components/LogViewer.tsx`

```typescript
"use client";

import { useEffect, useState } from "react";
import { fetchLogs, type DetectionLog } from "@/lib/api";

export function LogViewer() {
  const [logs, setLogs] = useState<DetectionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyHarmful, setOnlyHarmful] = useState(false);

  useEffect(() => {
    const loadLogs = async () => {
      try {
        setLoading(true);
        const data = await fetchLogs(20, 0, onlyHarmful);
        setLogs(data.logs);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load logs");
      } finally {
        setLoading(false);
      }
    };

    loadLogs();
  }, [onlyHarmful]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("ko-KR");
  };

  if (loading) {
    return <div>Loading logs...</div>;
  }

  if (error) {
    return <div className="text-red-500">Error: {error}</div>;
  }

  return (
    <div className="p-4 border rounded-lg">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">감지 로그</h2>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={onlyHarmful} onChange={(e) => setOnlyHarmful(e.target.checked)} />
          <span>유해한 것만 보기</span>
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-100">
              <th className="border p-2 text-left">시간</th>
              <th className="border p-2 text-left">텍스트</th>
              <th className="border p-2 text-left">유해 여부</th>
              <th className="border p-2 text-left">신뢰도</th>
              <th className="border p-2 text-left">모델</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="border p-2">{formatDate(log.created_at)}</td>
                <td className="border p-2">{log.text_content}</td>
                <td className="border p-2">
                  <span className={log.is_harmful ? "text-red-500" : "text-green-500"}>
                    {log.is_harmful ? "유해" : "정상"}
                  </span>
                </td>
                <td className="border p-2">{(log.confidence * 100).toFixed(2)}%</td>
                <td className="border p-2">{log.model_version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {logs.length === 0 && <div className="text-center text-gray-500 mt-4">로그가 없습니다.</div>}
    </div>
  );
}
```

#### C. 설정 제어 (Configuration)

서버의 민감도(Threshold)를 실시간으로 조정합니다.

**API**: `POST /admin/sync-settings`

**Payload**:

```json
{
  "key": "threshold_koelectra",
  "value": "0.6"
}
```

**UI 요구사항**:

- 슬라이더 또는 입력창 (0.0 ~ 1.0)
- '적용' 버튼 클릭 시 API 호출
- 성공 시 토스트 메시지 표시

**구현 예시**: `components/ThresholdConfig.tsx`

```typescript
"use client";

import { useState } from "react";
import { syncSettings } from "@/lib/api";

export function ThresholdConfig() {
  const [threshold, setThreshold] = useState(0.5);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSave = async () => {
    try {
      setLoading(true);
      setMessage(null);

      // 모델 타입에 따라 key 결정 (실제로는 서버 상태에서 가져와야 함)
      const key = "threshold_koelectra"; // 또는 'threshold_kanana'

      await syncSettings(key, threshold.toString());
      setMessage("✅ 설정이 적용되었습니다.");
    } catch (err) {
      setMessage(`❌ 오류: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 border rounded-lg">
      <h2 className="text-xl font-bold mb-4">민감도 설정</h2>

      <div className="space-y-4">
        <div>
          <label className="block mb-2">Threshold: {threshold.toFixed(2)}</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-sm text-gray-500">
            <span>0.0 (낮음)</span>
            <span>1.0 (높음)</span>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={loading}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
        >
          {loading ? "적용 중..." : "적용하기"}
        </button>

        {message && (
          <div
            className={`p-2 rounded ${
              message.includes("✅") ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
            }`}
          >
            {message}
          </div>
        )}
      </div>
    </div>
  );
}
```

### 6. 메인 페이지 구성

`app/page.tsx` (Next.js App Router):

```typescript
import { DashboardStats } from "@/components/DashboardStats";
import { LogViewer } from "@/components/LogViewer";
import { ThresholdConfig } from "@/components/ThresholdConfig";

export default function DashboardPage() {
  return (
    <main className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-8">유해 표현 필터 관리자 대시보드</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <DashboardStats />
        <ThresholdConfig />
      </div>

      <div className="mt-6">
        <LogViewer />
      </div>
    </main>
  );
}
```

### 7. 보안 주의사항 ⚠️

- **Supabase 직접 접근 금지**: 이 프로젝트는 Supabase 키를 프론트엔드에 저장하지 않습니다. 모든 데이터는 백엔드 API를 통해서만 주고받습니다.
- **환경 변수 관리**: `.env.local`은 Git에 커밋하지 마세요 (`.gitignore`에 포함)
- **API URL**: 프로덕션 배포 시 Vercel 환경 변수에서 `NEXT_PUBLIC_API_URL`을 설정하세요

---

## 🧪 통합 테스트 시나리오

개발이 완료되면 다음 순서로 연동을 테스트합니다.

### 1. 서버 기동

백엔드 개발자가 서버를 실행합니다:

```bash
cd server
uvicorn main:app --reload
```

### 2. 상태 확인

프론트엔드 대시보드 상단에 "🟢 Server Online" 표시가 뜨는지 확인합니다.

- `GET /health` API가 정상 응답하는지 확인
- 서버 상태 컴포넌트에 모델 정보가 표시되는지 확인

### 3. 로그 생성 및 조회

1. **로그 생성**:

   - 백엔드 Swagger UI(`http://localhost:8000/docs`)에서 `/analyze` 엔드포인트로 유해 텍스트 전송
   - 또는 실제 앱에서 유해 표현을 감지하여 로그 생성

2. **로그 조회**:
   - 대시보드 로그 페이지에서 `새로고침` 버튼 클릭
   - 생성된 로그가 테이블에 표시되는지 확인
   - 필터 기능(유해한 것만 보기)이 작동하는지 확인

### 4. 설정 변경 테스트

1. **Threshold 변경**:

   - 대시보드에서 민감도를 `0.5` → `0.9`로 변경하고 저장
   - 성공 메시지가 표시되는지 확인

2. **백엔드 확인**:
   - 백엔드 로그에 `[Settings] 🔧 Threshold 업데이트 완료` 메시지가 뜨는지 확인
   - 또는 `/health` API로 변경된 threshold 값 확인

### 5. 에러 처리 테스트

- 백엔드 서버를 종료하고 프론트엔드에서 API 호출 시 에러 메시지가 표시되는지 확인
- 네트워크 오류 시 사용자에게 적절한 피드백이 제공되는지 확인

---

## 📦 Vercel 배포 설정

### 1. vercel.json 파일 생성 (선택사항)

`vercel.json`:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "devCommand": "npm run dev",
  "installCommand": "npm install",
  "framework": "nextjs"
}
```

### 2. Vercel CLI로 배포

```bash
# Vercel CLI 설치
npm install -g vercel

# 로그인
vercel login

# 프로젝트 배포
cd admin-dashboard
vercel

# 프로덕션 배포
vercel --prod
```

### 3. GitHub 연동 (권장)

1. GitHub 저장소에 `admin-dashboard` 폴더 커밋 및 푸시
2. [Vercel Dashboard](https://vercel.com/dashboard) 접속
3. "Add New Project" 클릭
4. GitHub 저장소 선택
5. **Root Directory 설정**: `admin-dashboard` 선택
6. Framework Preset: Next.js
7. 환경 변수 설정:
   - `NEXT_PUBLIC_API_URL`: FastAPI 서버 URL (예: `https://api.your-domain.com`)

### 4. 환경 변수 설정 (Vercel Dashboard)

Vercel 대시보드에서 환경 변수 추가:

- **Key**: `NEXT_PUBLIC_API_URL`
- **Value**: `https://api.your-domain.com` (프로덕션) 또는 `http://localhost:8000` (개발)
- **Environment**: Production, Preview, Development

### 5. CORS 설정 업데이트

Vercel 배포 후 백엔드 서버의 CORS 설정에 배포된 도메인을 추가:

```python
# server/main.py
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "https://your-dashboard.vercel.app",  # Vercel 배포 주소
]
```

---

## 🔍 문제 해결

### 문제 1: CORS 에러

**증상**: 브라우저 콘솔에 CORS 에러 메시지

**해결 방법**:

1. FastAPI 서버의 `allow_origins`에 대시보드 도메인 추가
2. 개발 환경에서는 `allow_origins=["*"]`로 설정 가능 (프로덕션에서는 특정 도메인만 허용)

### 문제 2: 환경 변수가 적용되지 않음

**증상**: `NEXT_PUBLIC_API_URL`이 `undefined`

**해결 방법**:

1. Next.js에서는 `NEXT_PUBLIC_` 접두사가 필수
2. Vercel 대시보드에서 환경 변수 재설정
3. 빌드 후 재배포

### 문제 3: FastAPI 서버 연결 실패

**증상**: 네트워크 에러 또는 타임아웃

**해결 방법**:

1. FastAPI 서버가 실행 중인지 확인
2. 방화벽/보안 그룹에서 포트 허용 확인
3. 서버 URL이 올바른지 확인 (HTTPS vs HTTP)
4. CORS 설정 확인

---

## 📚 참고 자료

- **API 문서 (Swagger)**: `http://localhost:8000/docs` (서버 실행 시 접속 가능)
- **Task 46 문서**: 백엔드 API 구현 상세 내용 (`docs/46-supabase-admin-db.md`)
- [Next.js 공식 문서](https://nextjs.org/docs)
- [Vercel 배포 가이드](https://vercel.com/docs)
- [FastAPI CORS 설정](https://fastapi.tiangolo.com/tutorial/cors/)

## ✅ 체크리스트

### Backend

- [ ] CORS 설정 확인/수정
- [ ] API 엔드포인트 테스트 (`/health`, `/admin/logs`, `/admin/sync-settings`)
- [ ] Swagger UI 접근 가능 확인 (`/docs`)
- [ ] 팀원에게 API 명세서 전달

### Frontend

- [ ] 프로젝트 초기화 (Next.js)
- [ ] 환경 변수 설정 (`.env.local`)
- [ ] API 클라이언트 구현 (`lib/api.ts`)
- [ ] 서버 상태 표시 컴포넌트
- [ ] 로그 뷰어 컴포넌트
- [ ] 설정 제어 컴포넌트
- [ ] 메인 페이지 구성
- [ ] 로컬에서 테스트
- [ ] Vercel 프로젝트 생성
- [ ] 환경 변수 설정 (Vercel)
- [ ] 배포 및 테스트

## 🎯 다음 단계

구현 완료 후 추가 개선 사항:

1. **인증 시스템**: NextAuth.js로 로그인 기능 추가 (Task 47)
2. **실시간 업데이트**: WebSocket 또는 SSE 구현
3. **통계 대시보드**: 일일/주간 분석 통계, 차트 표시
4. **알림 시스템**: 서버 다운 알림, 이상 패턴 감지
5. **모니터링 대시보드**: Grafana, Prometheus 연동
