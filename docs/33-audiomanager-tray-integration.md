# Task 33: AudioManager 트레이 통합

## ✅ 상태: 완료

## 📋 작업 개요

시스템 트레이에서 직접 오디오 캡처를 제어할 수 있도록 `AudioManager` 클래스를 추가하고 트레이 메뉴에 통합했습니다. 보안을 강화하여 Deepgram API 키를 Electron에 저장하지 않고, Python FastAPI 서버를 통해서만 오디오를 스트리밍합니다.

## 🎯 핵심 목표

- ✅ **AudioManager Singleton 클래스** 생성
- ✅ **트레이 메뉴 통합** (Chrome, Edge, Discord 캡처)
- ✅ **보안 강화** (Deepgram API 키를 서버에서만 관리)
- ✅ **향상된 재연결 로직** (중복 방지, 타이머 관리)
- ✅ **파일명 네이밍 규칙 통일** (`onvoice*` → `onVoice*`)

## 📦 생성/수정된 파일

### 1. AudioManager 클래스
**파일**: `electron/main/AudioManager.ts`

Singleton 패턴으로 구현된 오디오 스트리밍 관리자입니다.

**주요 기능**:
- OnVoice Bridge를 통한 오디오 캡처
- Python FastAPI 서버로 WebSocket 스트리밍 (`ws://localhost:8000/ws/audio`)
- 자동 재연결 로직 (중복 방지, 타이머 관리)
- 전사 결과 수신 및 콘솔 로그 출력

```typescript
class AudioManager {
  private static instance: AudioManager | null = null;
  
  public static getInstance(): AudioManager;
  public async init(): Promise<void>;
  public async startStream(target: 'chrome' | 'edge' | 'discord'): Promise<void>;
  public async stopStream(): Promise<void>;
  public getStatus(): AudioManagerStatus;
}
```

### 2. 파일명 네이밍 규칙 통일

모든 OnVoice 관련 파일명을 `onVoice` (대문자 V)로 통일했습니다:

- `onvoiceBridge.ts` → `onVoiceBridge.ts`
- `onvoiceBridgeAdapter.ts` → `onVoiceBridgeAdapter.ts`
- `onvoiceService.ts` → `onVoiceService.ts`
- `onvoiceHandlers.ts` → `onVoiceHandlers.ts`

### 3. 트레이 메뉴 업데이트
**파일**: `electron/tray.ts`

트레이 메뉴에 AudioManager를 통합하여 직접 오디오 캡처를 제어할 수 있도록 했습니다.

**메뉴 항목**:
- "Capture Chrome": Chrome 오디오 캡처 시작
- "Capture Edge": Edge 오디오 캡처 시작
- "Capture Discord": Discord 오디오 캡처 시작
- "Stop Capture": 캡처 중지 (스트리밍 중일 때만 활성화)

**상태 표시**:
- 트레이 아이콘 색상: 초록색 (스트리밍 중) / 파란색 (중지)
- 툴팁: 현재 스트리밍 상태 및 대상 앱 표시

## 🔧 기술 스택

- **OnVoice Bridge**: `electron/main/onVoiceBridge.ts` (electron-edge-js 기반)
- **WebSocket**: `ws` (v8.14.2)
- **STT**: Python FastAPI 서버 (`ws://localhost:8000/ws/audio`)
- **아키텍처**: Singleton 패턴

## 📝 사용 방법

### 트레이 메뉴에서 사용

1. 시스템 트레이 아이콘 우클릭
2. "Capture Chrome", "Capture Edge", 또는 "Capture Discord" 선택
3. 오디오가 Python 서버로 스트리밍됨
4. "Stop Capture"로 중지

### 코드에서 직접 사용

```typescript
import AudioManager from './main/AudioManager';

const audioManager = AudioManager.getInstance();
await audioManager.init();
await audioManager.startStream('chrome');
// ... 나중에
await audioManager.stopStream();
```

## 🔄 기존 시스템과의 관계

### AudioManager vs OnVoiceService

| 항목 | AudioManager | OnVoiceService |
|------|-------------|----------------|
| 사용 방식 | 트레이 메뉴 (직접) | IPC (렌더러) |
| Deepgram 직접 연결 | 없음 (보안) | 지원 (조건부) |
| 서버 경유 | 필수 | 선택적 |
| 코드 복잡도 | 낮음 (332줄) | 높음 (429줄) |
| 재연결 로직 | 강화됨 | 기본 |
| IPC 채널 | 없음 | `ONVOICE_CHANNELS` |

**AudioManager의 장점**:
- 보안 강화: Deepgram API 키를 Electron에 저장하지 않음
- 단순화된 구조: 트레이에서 직접 사용 가능
- 향상된 재연결 로직: 중복 방지, 타이머 관리

## 🔐 보안 개선

### 이전 방식 (OnVoiceService)
- `DEEPGRAM_API_KEY` 환경 변수가 있으면 Deepgram에 직접 연결
- API 키가 Electron 프로세스에 노출될 위험

### 현재 방식 (AudioManager)
- 항상 Python FastAPI 서버를 통해 연결
- API 키는 서버에서만 관리
- Electron은 오디오 캡처와 전송만 담당

## 🎯 오디오 데이터 흐름

```
OnVoice COM DLL → onVoiceBridge → AudioManager → WebSocket → Python FastAPI → Deepgram
```

1. C# COM DLL이 프로세스 오디오 캡처
2. `onVoiceBridge`가 PCM 데이터를 Buffer로 변환
3. `AudioManager`가 WebSocket으로 Python 서버에 전송
4. Python 서버가 Deepgram과 통신하여 STT 수행
5. 전사 결과를 WebSocket으로 다시 전송
6. `AudioManager`가 콘솔에 로그 출력

## ⚙️ 환경 변수

- `SERVER_WS_URL`: WebSocket URL (기본값: `ws://localhost:8000/ws/audio`)

## 🔗 관련 작업

- **Task 29**: OnVoice COM Bridge 통합
- **Task 27**: Deepgram STT 통합
- **Task 24**: 음성 STT API

## 📝 다음 단계

- [x] AudioManager 구현
- [x] 트레이 메뉴 통합
- [x] 파일명 네이밍 규칙 통일
- [x] 보안 강화
- [ ] 전사 결과를 UI에 표시 (선택적)
- [ ] 에러 처리 UI 개선 (선택적)

## 업데이트 히스토리

- 2025-01-XX: Task 33 완료 - AudioManager 트레이 통합, 보안 강화, 파일명 네이밍 규칙 통일

