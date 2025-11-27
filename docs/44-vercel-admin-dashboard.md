# 작업 44: Vercel 관리자 대시보드 구축 가이드

## 상태
📝 계획 단계

## 📋 작업 개요

FastAPI 서버를 모니터링하고 관리하기 위한 **관리자 대시보드**를 Vercel에 배포하는 방법에 대한 가이드 문서입니다.

**목표**:

1. **관리자 대시보드 프로젝트 구성**: Next.js 또는 React 기반 프론트엔드 설정
2. **FastAPI 서버 연동**: 기존 서버의 API 엔드포인트와 통신
3. **Vercel 배포**: 클라우드 환경에서 대시보드 배포 및 운영
4. **실시간 모니터링**: 서버 상태, 분석 결과, 통계 정보 표시
5. **설정 관리**: Threshold 등 설정 값 조정 및 모니터링

**배경**:

- 현재 FastAPI 서버(`server/main.py`)는 로컬 또는 원격 서버에서 실행 중
- 서버 상태 확인, 텍스트 분석 테스트, 설정 변경 등을 웹 UI로 관리하고 싶음
- Vercel은 Next.js와 최적 통합되어 있으며 무료 티어로 충분히 운영 가능
- 관리자 대시보드를 별도 프로젝트로 분리하여 독립적으로 배포 및 관리

**관련 작업**:

- Task 20 (FastAPI 기본 구조) ✅ - 서버 API 엔드포인트
- Task 21 (텍스트 분석 API) ✅ - `/analyze` 엔드포인트
- Task 43 (Threshold 설정) ✅ - Threshold 구성 방법

## 🏗️ 아키텍처 개요

```
┌─────────────────────────────────────────┐
│   Vercel (관리자 대시보드)              │
│   https://admin-dashboard.vercel.app    │
│                                         │
│   - Next.js / React 앱                  │
│   - 클라이언트 사이드 또는              │
│   - Next.js API Routes (Proxy)          │
└─────────────────┬───────────────────────┘
                  │ HTTP/HTTPS
                  │ CORS 허용 필요
                  ▼
┌─────────────────────────────────────────┐
│   FastAPI 서버                          │
│   http://localhost:8000                 │
│   또는 https://api.your-domain.com      │
│                                         │
│   - /health                             │
│   - /analyze                            │
│   - /keywords                           │
│   - /ws/audio (WebSocket)               │
└─────────────────────────────────────────┘
```

## 🎯 현재 FastAPI 서버 엔드포인트

관리자 대시보드에서 활용 가능한 API 엔드포인트:

### 1. 서버 상태 확인
```http
GET /health
```

**응답 예시**:
```json
{
  "status": "ok",
  "stt_service": "Deepgram (nova-2)",
  "ai_model": "Kanana-LoRA",
  "mode": "Integrated Filter"
}
```

### 2. 텍스트 분석
```http
POST /analyze
Content-Type: application/json

{
  "text": "분석할 텍스트"
}
```

**응답 예시**:
```json
{
  "has_violation": false,
  "ai_analysis": {
    "is_harmful": false,
    "confidence": 0.1234
  }
}
```

### 3. 키워드 목록 조회
```http
GET /keywords
```

**응답 예시**:
```json
{
  "keywords": []
}
```

### 4. 오디오 스트리밍 (WebSocket)
```http
WebSocket /ws/audio
```

실시간 오디오 분석용 (대시보드에서는 선택적 구현)

## 📁 프로젝트 구조

### 옵션 A: Next.js App Router (권장)

```
admin-dashboard/
├── package.json
├── tsconfig.json
├── next.config.js
├── vercel.json                    # Vercel 배포 설정
├── .env.local                     # 환경 변수 (로컬)
├── .env.example                   # 환경 변수 템플릿
├── app/
│   ├── layout.tsx                 # 루트 레이아웃
│   ├── page.tsx                   # 대시보드 메인 페이지
│   ├── api/
│   │   └── proxy/
│   │       └── route.ts           # API Proxy (선택사항)
│   └── dashboard/
│       ├── stats/
│       │   └── page.tsx           # 통계 페이지
│       └── settings/
│           └── page.tsx           # 설정 페이지
├── components/
│   ├── DashboardStats.tsx         # 서버 상태 표시
│   ├── TextAnalyzer.tsx           # 텍스트 분석 UI
│   ├── ThresholdConfig.tsx        # Threshold 설정
│   ├── ModelInfo.tsx              # 모델 정보 표시
│   └── ui/                        # 공통 UI 컴포넌트
│       ├── Button.tsx
│       ├── Card.tsx
│       └── Badge.tsx
├── lib/
│   ├── api.ts                     # FastAPI 서버 통신
│   ├── types.ts                   # TypeScript 타입 정의
│   └── utils.ts                   # 유틸리티 함수
└── styles/
    └── globals.css
```

### 옵션 B: React + Vite

```
admin-dashboard/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vercel.json
├── .env.local
├── index.html
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── DashboardStats.tsx
│   │   ├── TextAnalyzer.tsx
│   │   └── ...
│   ├── lib/
│   │   ├── api.ts
│   │   └── types.ts
│   └── styles/
│       └── index.css
```

## 🚀 구현 단계

### Step 1: 프로젝트 초기화

#### Next.js (권장)

```bash
cd admin-dashboard

# Next.js 프로젝트 생성 (기존 폴더에)
npx create-next-app@latest . --typescript --tailwind --app --no-git

# 또는 빈 폴더에서 시작
npx create-next-app@latest admin-dashboard --typescript --tailwind --app
```

#### React + Vite (대안)

```bash
cd admin-dashboard

npm create vite@latest . -- --template react-ts

npm install
```

### Step 2: 의존성 설치

```bash
# Next.js인 경우
npm install axios
# 또는 fetch API 사용 (내장)

# React + Vite인 경우
npm install axios

# UI 라이브러리 (선택사항)
npm install lucide-react          # 아이콘
npm install recharts              # 차트/그래프
npm install @tanstack/react-query # 데이터 fetching 관리
```

### Step 3: 환경 변수 설정

`.env.local` 파일 생성:

```env
# FastAPI 서버 URL
NEXT_PUBLIC_API_URL=http://localhost:8000

# 프로덕션에서는 실제 서버 URL
# NEXT_PUBLIC_API_URL=https://api.your-domain.com
```

`.env.example` 파일 (Git에 커밋):

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### Step 4: API 클라이언트 구현

`lib/api.ts` 파일:

```typescript
// lib/api.ts
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface HealthResponse {
  status: string;
  stt_service: string;
  ai_model: string;
  mode: string;
}

export interface AnalyzeRequest {
  text: string;
}

export interface AnalyzeResponse {
  has_violation: boolean;
  ai_analysis: {
    is_harmful: boolean;
    confidence: number;
  } | null;
}

export interface KeywordsResponse {
  keywords: string[];
}

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
 * 텍스트 분석
 */
export async function analyzeText(text: string): Promise<AnalyzeResponse> {
  const response = await fetch(`${API_URL}/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });
  
  if (!response.ok) {
    throw new Error(`Analysis failed: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * 키워드 목록 조회
 */
export async function getKeywords(): Promise<KeywordsResponse> {
  const response = await fetch(`${API_URL}/keywords`);
  if (!response.ok) {
    throw new Error(`Keywords fetch failed: ${response.statusText}`);
  }
  return response.json();
}
```

### Step 5: TypeScript 타입 정의

`lib/types.ts` 파일:

```typescript
// lib/types.ts
export type ServerStatus = 'ok' | 'error' | 'loading';

export interface DashboardStats {
  serverStatus: ServerStatus;
  modelInfo: {
    aiModel: string;
    sttService: string;
    mode: string;
  };
  lastChecked: Date | null;
}

export interface AnalysisResult {
  text: string;
  isHarmful: boolean;
  confidence: number;
  timestamp: Date;
}
```

### Step 6: 컴포넌트 구현 예시

#### 서버 상태 표시 컴포넌트

`components/DashboardStats.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { fetchHealth, type HealthResponse } from '@/lib/api';

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
        setError(err instanceof Error ? err.message : 'Unknown error');
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
          <span className={health.status === 'ok' ? 'text-green-500' : 'text-red-500'}>
            {health.status}
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
      </div>
    </div>
  );
}
```

#### 텍스트 분석 컴포넌트

`components/TextAnalyzer.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { analyzeText, type AnalyzeResponse } from '@/lib/api';

export function TextAnalyzer() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    if (!text.trim()) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await analyzeText(text);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 border rounded-lg">
      <h2 className="text-xl font-bold mb-4">텍스트 분석 테스트</h2>
      
      <div className="space-y-4">
        <div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="분석할 텍스트를 입력하세요..."
            className="w-full p-2 border rounded"
            rows={5}
          />
        </div>
        
        <button
          onClick={handleAnalyze}
          disabled={loading || !text.trim()}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
        >
          {loading ? '분석 중...' : '분석하기'}
        </button>

        {error && (
          <div className="text-red-500">Error: {error}</div>
        )}

        {result && (
          <div className="p-4 bg-gray-100 rounded">
            <div className="space-y-2">
              <div>
                <span className="font-semibold">유해 여부: </span>
                <span className={result.has_violation ? 'text-red-500' : 'text-green-500'}>
                  {result.has_violation ? '유해' : '정상'}
                </span>
              </div>
              {result.ai_analysis && (
                <>
                  <div>
                    <span className="font-semibold">신뢰도: </span>
                    {(result.ai_analysis.confidence * 100).toFixed(2)}%
                  </div>
                  <div>
                    <span className="font-semibold">AI 판단: </span>
                    {result.ai_analysis.is_harmful ? '유해' : '정상'}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

### Step 7: 메인 페이지 구성

`app/page.tsx` (Next.js App Router):

```typescript
import { DashboardStats } from '@/components/DashboardStats';
import { TextAnalyzer } from '@/components/TextAnalyzer';

export default function DashboardPage() {
  return (
    <main className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-8">유해 표현 필터 관리자 대시보드</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <DashboardStats />
        <TextAnalyzer />
      </div>
    </main>
  );
}
```

## 🌐 CORS 설정

관리자 대시보드가 FastAPI 서버와 통신하려면 CORS 설정이 필요합니다.

`server/main.py`에서 현재 설정 확인:

```python
# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 현재는 모든 도메인 허용
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**프로덕션 환경에서는 특정 도메인만 허용**하도록 변경 권장:

```python
# 환경 변수에서 허용된 도메인 목록 읽기
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,https://admin-dashboard.vercel.app"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## 📦 Vercel 배포 설정

### 1. vercel.json 파일 생성

`vercel.json`:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "devCommand": "npm run dev",
  "installCommand": "npm install",
  "framework": "nextjs",
  "env": {
    "NEXT_PUBLIC_API_URL": "@api-url"
  }
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
6. Framework Preset: Next.js (또는 Vite)
7. 환경 변수 설정:
   - `NEXT_PUBLIC_API_URL`: FastAPI 서버 URL

### 4. 환경 변수 설정 (Vercel Dashboard)

Vercel 대시보드에서 환경 변수 추가:

- **Key**: `NEXT_PUBLIC_API_URL`
- **Value**: `https://api.your-domain.com` (프로덕션) 또는 `http://localhost:8000` (개발)
- **Environment**: Production, Preview, Development

## 🔒 보안 고려사항

### 옵션 1: 클라이언트 사이드 직접 통신

- **장점**: 구현 간단, 서버 리소스 절약
- **단점**: API URL이 클라이언트에 노출, CORS 설정 필요

### 옵션 2: Next.js API Routes를 통한 Proxy

더 안전한 방법: Next.js 서버가 중간 프록시 역할

`app/api/proxy/analyze/route.ts`:

```typescript
// app/api/proxy/analyze/route.ts
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const response = await fetch(`${API_URL}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to analyze text' },
      { status: 500 }
    );
  }
}
```

클라이언트에서는 Next.js API Route를 호출:

```typescript
// lib/api.ts (수정)
export async function analyzeText(text: string): Promise<AnalyzeResponse> {
  const response = await fetch('/api/proxy/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });
  
  return response.json();
}
```

### 인증 시스템 추가 (선택사항)

관리자 전용 접근 제어를 위해 NextAuth.js 사용:

```bash
npm install next-auth
```

## 📊 추가 기능 구현 제안

### 1. 실시간 모니터링

- Server-Sent Events (SSE) 또는 WebSocket을 통한 실시간 업데이트
- 서버 상태 변화 알림
- 분석 결과 실시간 표시

### 2. 통계 및 히스토리

- 일일/주간 분석 통계
- 유해 표현 감지 횟수 추이
- 모델 성능 메트릭

### 3. Threshold 설정 UI

- `docs/43-threshold-configuration.md` 참고
- Threshold 값 조정 인터페이스
- 변경 시 즉시 반영 (서버 재시작 또는 동적 설정)

### 4. 로그 뷰어

- 서버 로그 실시간 조회
- 에러 로그 필터링
- 검색 및 필터 기능

## 🔍 문제 해결

### 문제 1: CORS 에러

**증상**: 브라우저 콘솔에 CORS 에러 메시지

**해결 방법**:
1. FastAPI 서버의 `allow_origins`에 대시보드 도메인 추가
2. 또는 Next.js API Routes를 사용하여 프록시 구성

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

## 📚 참고 자료

- [Next.js 공식 문서](https://nextjs.org/docs)
- [Vercel 배포 가이드](https://vercel.com/docs)
- [FastAPI CORS 설정](https://fastapi.tiangolo.com/tutorial/cors/)
- [Task 43: Threshold 설정](./43-threshold-configuration.md)
- [Task 20: FastAPI 설정](./20-fastapi-setup.md)

## ✅ 체크리스트

구현 단계별 체크리스트:

- [ ] 프로젝트 초기화 (Next.js 또는 React + Vite)
- [ ] 환경 변수 설정 (`.env.local`, `.env.example`)
- [ ] API 클라이언트 구현 (`lib/api.ts`)
- [ ] TypeScript 타입 정의 (`lib/types.ts`)
- [ ] 서버 상태 표시 컴포넌트
- [ ] 텍스트 분석 컴포넌트
- [ ] 메인 페이지 구성
- [ ] FastAPI 서버 CORS 설정 확인/수정
- [ ] 로컬에서 테스트
- [ ] Vercel 프로젝트 생성
- [ ] 환경 변수 설정 (Vercel)
- [ ] 배포 및 테스트
- [ ] 도메인 설정 (선택사항)
- [ ] HTTPS 인증서 확인

## 🎯 다음 단계

구현 완료 후 추가 개선 사항:

1. **인증 시스템**: NextAuth.js로 로그인 기능 추가
2. **데이터베이스 연동**: 분석 히스토리 저장 (PostgreSQL, MongoDB)
3. **실시간 업데이트**: WebSocket 또는 SSE 구현
4. **알림 시스템**: 서버 다운 알림, 이상 패턴 감지
5. **모니터링 대시보드**: Grafana, Prometheus 연동

