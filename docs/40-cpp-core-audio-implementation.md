# Task 40: C++ Core Audio 구현 상세

## 상태

✅ 완료

## 📋 개요

**목표**: 특정 프로세스(PID)의 오디오만을 격리하여 캡처하는 "Application Loopback" 기능의 내부 구현 원리를 문서화합니다.

**배경**:

- C#(.NET)의 `NAudio`나 표준 라이브러리는 **System Loopback**(PC 전체 소리) 캡처에는 용이하나, **특정 PID 오디오 캡처**는 지원하지 않거나 매우 불안정합니다.

- 이를 해결하기 위해 Windows 10(Build 20348 이상) 및 Windows 11에서 도입된 WASAPI의 `PROCESS_LOOPBACK_MODE`를 Native C++로 직접 제어합니다.

- 이 문서는 `OnVoiceAudioBridge` C++ 프로젝트의 핵심 로직을 설명합니다.

**관련 작업**:

- Task 29 (OnVoice COM Bridge 통합) ✅

## 🏗️ 아키텍처 및 기술 스택

### 기술 스택

- **Language**: C++ 17 (또는 C++ 20)

- **Framework**: ATL (Active Template Library) / WRL (Windows Runtime Library)

- **API**: Windows Core Audio API (WASAPI), Windows.Media.Ocr (C++/WinRT)

- **Interface**: COM (Component Object Model)

### 데이터 흐름

```mermaid
graph LR
    A[Target App (Chrome/Edge)] -->|Audio Session| B(Windows Audio Engine)
    B -->|PID Filtering| C[C++ WASAPI Loopback]
    C -->|PCM Data| D[C# COM Wrapper]
    D -->|Buffer| E[Electron/Node.js]
```

## 🔍 핵심 구현 상세 (PID Loopback)

C#에서 불가능한 기능을 C++에서 구현한 핵심 코드는 `ActivateAudioInterfaceAsync`와 `AUDIOCLIENT_ACTIVATION_PARAMS`의 조합입니다.

### 1. 활성화 매개변수 설정 (The "Magic" Part)

일반적인 루프백과 달리, 캡처 대상을 특정 프로세스로 한정하기 위해 `AUDIOCLIENT_ACTIVATION_PARAMS` 구조체를 사용합니다.

```cpp
// 핵심 구조체: 특정 프로세스 ID를 타겟팅
AUDIOCLIENT_ACTIVATION_PARAMS activationParams = {};
activationParams.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
activationParams.ProcessLoopbackParams.TargetProcessId = targetPid; // 캡처할 PID
activationParams.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
```

### 2. 비동기 인터페이스 활성화

`CoCreateInstance` 대신 `ActivateAudioInterfaceAsync`를 사용하여 오디오 인터페이스를 비동기적으로 생성합니다. 이 과정에서 위에서 정의한 `activationParams`를 전달합니다.

```cpp
// IActivateAudioInterfaceCompletionHandler 구현 필요
PROPVARIANT activateParams = {};
activateParams.vt = VT_BLOB;
activateParams.blob.cbSize = sizeof(activationParams);
activateParams.blob.pBlobData = (BYTE*)&activationParams;

// WASAPI 인터페이스 비동기 활성화
HRESULT hr = ActivateAudioInterfaceAsync(
    VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, // 특수 장치 ID
    __uuidof(IAudioClient),
    &activateParams,
    this, // Completion Handler
    &op   // Async Operation
);
```

### 3. 오디오 캡처 루프 (Worker Thread)

오디오 클라이언트가 활성화되면 별도 스레드에서 데이터를 계속 퍼올립니다(Pump).

- **IAudioCaptureClient::GetBuffer**: 오디오 패킷 획득
- **Event Firing**: 획득한 PCM 데이터를 COM 이벤트(`OnAudioData`)를 통해 C#으로 전송
- **ReleaseBuffer**: 버퍼 반환

## 📷 Windows OCR 구현 (C++/WinRT)

이 모듈은 오디오뿐만 아니라 고성능 OCR도 담당합니다. C++/WinRT를 사용하여 `Windows.Media.Ocr` 네임스페이스에 직접 접근합니다.

1. **SoftwareBitmap 변환**: 입력받은 `byte*` 이미지 데이터를 WinRT `SoftwareBitmap`으로 변환 (메모리 복사 최소화)

2. **OcrEngine**: `OcrEngine::TryCreateFromUserProfileLanguages()`로 엔진 생성 (캐싱됨)

3. **RecognizeAsync**: 비동기 인식 수행 후 텍스트 추출

## 📂 프로젝트 파일 구조 (참고)

GitHub 리포지토리(`cccwon2/onvoice-com-bridge`) 기준 핵심 파일들입니다.

```text
OnVoiceAudioBridge/
├── OnVoiceAudioBridge.idl      # COM 인터페이스 정의 (Type Library 소스)
├── OnVoiceCapture.h            # 헤더: 클래스 선언 및 WASAPI 멤버 변수
├── OnVoiceCapture.cpp          # 구현: ActivateAudioInterfaceAsync 및 캡처 루프
├── dllmain.cpp                 # DLL 진입점 (COM 등록/해제)
├── pch.h                       # 미리 컴파일된 헤더 (Windows 헤더 포함)
└── framework.h
```

### 주요 인터페이스 (IDL)

```idl
[
    uuid(...), // IID
    object,
    local,
    pointer_default(unique)
]
interface IOnVoiceCapture : IUnknown
{
    // 초기화 및 제어
    HRESULT StartCapture([in] long pid);
    HRESULT StopCapture();
    
    // OCR 기능
    HRESULT PerformOcr([in] SAFEARRAY(byte) imageData, [out, retval] BSTR* result);
    
    // 이벤트 구독을 위한 Connection Point
    [propget] HRESULT OnAudioData([out, retval] IUnknown** pVal);
};
```

## ⚠️ 빌드 및 배포 주의사항

1. **Windows SDK 버전**: `AUDIOCLIENT_ACTIVATION_PARAMS`를 사용하려면 **Windows 10 SDK (10.0.20348.0)** 이상이 필요합니다.

2. **런타임 요구사항**: 실행되는 PC가 Windows 10 Ver 2004 (Build 19041) 이상이어야 프로세스 루프백 API가 정상 동작합니다. (그 이전 버전에서는 실패 처리 필요)

3. **MTA Threading**: COM 객체는 멀티스레드 환경에서 동작하므로 `CoInitializeEx(NULL, COINIT_MULTITHREADED)` 모델을 따릅니다.

## 🔗 참고 자료

- [Application Loopback API (Microsoft Docs)](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording)
- [ActivateAudioInterfaceAsync function](https://learn.microsoft.com/en-us/windows/win32/api/mmdeviceapi/nf-mmdeviceapi-activateaudiointerfaceasync)
- [Windows.Media.Ocr Namespace](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr)

