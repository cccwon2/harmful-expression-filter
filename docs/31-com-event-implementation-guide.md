# COM 이벤트 구현 가이드

## 개요

`dotnet/OnVoiceComBridge/Startup.cs`의 `SubscribeComEvents()` 메서드에서 실제 COM 이벤트를 구독하는 방법을 설명합니다.

## 구현 방법

### 방법 1: COM Interop 어셈블리 사용 (권장)

COM 인터페이스를 정의한 어셈블리가 있는 경우:

1. **COM Interop 어셈블리 추가**
   - TLB 파일에서 어셈블리 생성:
     ```bash
     tlbimp OnVoiceAudioBridge.tlb /out:OnVoiceAudioBridgeLib.dll
     ```
   - 또는 Visual Studio에서 "Add COM Reference" 사용

2. **프로젝트 파일에 참조 추가**
   ```xml
   <ItemGroup>
     <Reference Include="OnVoiceAudioBridgeLib">
       <HintPath>path\to\OnVoiceAudioBridgeLib.dll</HintPath>
     </Reference>
   </ItemGroup>
   ```

3. **Startup.cs 수정**
   ```csharp
   private static void SubscribeComEvents()
   {
       if (_capture == null) return;

       try
       {
           // 타입 캐스팅 후 이벤트 구독
           var typedCapture = (OnVoiceAudioBridgeLib.IOnVoiceCapture)_capture;
           typedCapture.OnAudioData += OnAudioData;
           Console.WriteLine("[OnVoiceComBridge] COM 이벤트 구독 성공");
       }
       catch (Exception ex)
       {
           Console.Error.WriteLine($"[OnVoiceComBridge] COM 이벤트 구독 실패: {ex.Message}");
           throw;
       }
   }
   ```

### 방법 2: Dynamic + Reflection 사용

COM Interop 어셈블리가 없는 경우:

```csharp
using System.Reflection;

private static void SubscribeComEvents()
{
    if (_capture == null) return;

    try
    {
        // dynamic 객체에서 이벤트 가져오기
        var eventInfo = _capture.GetType().GetEvent("OnAudioData");
        if (eventInfo == null)
        {
            throw new InvalidOperationException("OnAudioData 이벤트를 찾을 수 없습니다.");
        }

        // 이벤트 핸들러 생성
        var handlerType = eventInfo.EventHandlerType;
        var methodInfo = typeof(Startup).GetMethod("OnAudioDataHandler", 
            BindingFlags.NonPublic | BindingFlags.Static);
        
        var handler = Delegate.CreateDelegate(handlerType, methodInfo);
        eventInfo.AddEventHandler(_capture, handler);
        
        Console.WriteLine("[OnVoiceComBridge] COM 이벤트 구독 성공 (Reflection)");
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"[OnVoiceComBridge] COM 이벤트 구독 실패: {ex.Message}");
        throw;
    }
}

// 이벤트 핸들러 메서드 (COM 이벤트 시그니처에 맞게 수정 필요)
private static void OnAudioDataHandler(object sender, byte[] data)
{
    OnAudioData(data);
}
```

### 방법 3: IConnectionPoint 직접 사용

COM Connection Point를 직접 사용하는 경우:

```csharp
using System.Runtime.InteropServices;

private static void SubscribeComEvents()
{
    if (_capture == null) return;

    try
    {
        // IConnectionPointContainer 가져오기
        var cpContainer = (IConnectionPointContainer)_capture;
        Guid eventIID = new Guid("..."); // COM 이벤트 인터페이스 GUID
        
        IConnectionPoint connectionPoint;
        cpContainer.FindConnectionPoint(ref eventIID, out connectionPoint);
        
        // 이벤트 싱크 구현
        var eventSink = new OnVoiceCaptureEventSink();
        uint cookie;
        connectionPoint.Advise(eventSink, out cookie);
        
        Console.WriteLine($"[OnVoiceComBridge] COM 이벤트 구독 성공 (Cookie: {cookie})");
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"[OnVoiceComBridge] COM 이벤트 구독 실패: {ex.Message}");
        throw;
    }
}

// 이벤트 싱크 클래스
[ComVisible(true)]
public class OnVoiceCaptureEventSink : IOnVoiceCaptureEvents
{
    public void OnAudioData(byte[] data)
    {
        Startup.OnAudioData(data);
    }
}
```

## OnAudioData 메서드 시그니처 수정

COM 이벤트의 실제 시그니처에 맞게 `OnAudioData` 메서드를 수정해야 합니다:

### 예시 1: 단순 바이트 배열
```csharp
private static void OnAudioData(byte[] buffer)
{
    var cb = _audioCallback;
    if (cb == null) return;

    _ = cb(new
    {
        type = "audio",
        data = buffer
    });
}
```

### 예시 2: 바이트 배열 + 크기
```csharp
private static void OnAudioData(byte[] data, int size)
{
    var cb = _audioCallback;
    if (cb == null) return;

    // 실제 데이터만 복사
    var buffer = new byte[size];
    Array.Copy(data, buffer, size);

    _ = cb(new
    {
        type = "audio",
        data = buffer
    });
}
```

### 예시 3: IntPtr 사용
```csharp
using System.Runtime.InteropServices;

private static void OnAudioData(IntPtr data, int size)
{
    var cb = _audioCallback;
    if (cb == null) return;

    // IntPtr에서 바이트 배열로 복사
    var buffer = new byte[size];
    Marshal.Copy(data, buffer, 0, size);

    _ = cb(new
    {
        type = "audio",
        data = buffer
    });
}
```

## 디버깅 팁

### COM 객체 정보 확인
```csharp
private static void EnsureComObject()
{
    // ... 기존 코드 ...
    
    // 디버깅: COM 객체 타입 정보 출력
    Console.WriteLine($"[OnVoiceComBridge] COM 객체 타입: {_capture.GetType().FullName}");
    Console.WriteLine($"[OnVoiceComBridge] COM 객체 인터페이스:");
    foreach (var iface in _capture.GetType().GetInterfaces())
    {
        Console.WriteLine($"  - {iface.FullName}");
    }
    
    // 이벤트 목록 출력
    Console.WriteLine($"[OnVoiceComBridge] COM 객체 이벤트:");
    foreach (var evt in _capture.GetType().GetEvents())
    {
        Console.WriteLine($"  - {evt.Name} ({evt.EventHandlerType?.FullName})");
    }
}
```

### 이벤트 수신 확인
```csharp
private static void OnAudioData(byte[] buffer)
{
    Console.WriteLine($"[OnVoiceComBridge] OnAudioData 호출됨: {buffer?.Length ?? 0} bytes");
    
    var cb = _audioCallback;
    if (cb == null)
    {
        Console.Warn("[OnVoiceComBridge] _audioCallback이 null입니다!");
        return;
    }

    try
    {
        _ = cb(new
        {
            type = "audio",
            data = buffer
        });
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"[OnVoiceComBridge] 콜백 호출 오류: {ex.Message}");
    }
}
```

## 다음 단계

1. COM 인터페이스 정의 확인 (TLB 파일 또는 문서)
2. 적절한 방법 선택 (어셈블리 / Reflection / Connection Point)
3. `SubscribeComEvents()` 구현
4. `OnAudioData()` 시그니처 수정
5. 빌드 및 테스트

## 참고 자료

- [.NET COM Interop](https://learn.microsoft.com/dotnet/standard/native-interop/cominterop)
- [IConnectionPoint Interface](https://learn.microsoft.com/windows/win32/api/ocidl/nn-ocidl-iconnectionpoint)
- [Type.GetEvent Method](https://learn.microsoft.com/dotnet/api/system.type.getevent)

