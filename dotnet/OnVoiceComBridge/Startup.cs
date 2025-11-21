using System;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Threading.Tasks;

namespace OnVoiceComBridge
{
    /// <summary>
    /// Entry point class for electron-edge-js.
    /// This class is instantiated by edge-js and Invoke(...) is called from Node.
    /// 
    /// 이 bridge는 winax 대체 역할을 하며, Node/Electron에서는 StartCapture(pid) / StopCapture + audio 이벤트 스트림만 신경 쓰면 됩니다.
    /// COM 이벤트 구현부(SubscribeComEvents / OnAudioData)는 실제 OnVoice COM 인터페이스에 맞게 채워야 합니다.
    /// </summary>
    [SupportedOSPlatform("windows")]
    public class Startup
    {
        // COM capture object (dynamic to avoid hard dependency on generated interop types)
        private static dynamic? _capture;

        // Connection Point Cookie (for unadvise)
        private static uint _connectionCookie = 0;
        private static IConnectionPoint? _connectionPoint;

        // JS callback passed from Node (edge-js marshalling)
        // JS 함수 시그니처: (msg: any, cb: (err: Error | null, res?: any) => void) => void
        private static Func<object, Task<object>>? _audioCallback;

        public async Task<object> Invoke(dynamic input)
        {
            string command = (string)input.command;

            switch (command)
            {
                case "init":
                    // Save callback from JS (onAudioData)
                    _audioCallback = (Func<object, Task<object>>)input.onAudioData;

                    EnsureComObject();
                    SubscribeComEvents();

                    // Return simple status object
                    return new { ok = true, source = "OnVoiceComBridge", action = "init" };

                case "start":
                    EnsureComObject();
                    int pid = (int)input.pid;
                    // TODO: COM interface 메서드 이름이 다르면 여기 수정
                    if (_capture == null)
                        throw new InvalidOperationException("COM object not initialized");
                    _capture.StartCapture(pid);
                    return new { ok = true, pid };

                case "stop":
                    if (_capture != null)
                    {
                        // TODO: COM interface 메서드 이름 확인
                        _capture.StopCapture();
                    }
                    return new { ok = true };

                default:
                    return new { ok = false, error = $"Unknown command: {command}" };
            }
        }

        /// <summary>
        /// Create COM object if not created yet.
        /// ProgID must match the registered OnVoiceAudioBridge COM class.
        /// </summary>
        private static void EnsureComObject()
        {
            if (_capture != null) return;

            // ⚠️ ProgID는 실제 프로젝트에 맞게 수정 필요
            const string progId = "OnVoiceAudioBridge.OnVoiceCapture";

            Type t = Type.GetTypeFromProgID(progId, throwOnError: true)
                     ?? throw new InvalidOperationException($"COM ProgID not found: {progId}");

            _capture = Activator.CreateInstance(t)
                       ?? throw new InvalidOperationException($"Failed to create COM instance: {progId}");
        }

        /// <summary>
        /// Subscribe to COM events (OnAudioData) using IConnectionPoint.
        /// 
        /// 이 구현은 IConnectionPoint를 사용하여 COM 이벤트를 구독합니다.
        /// 기존 winax 코드의 connectionPoint.advise() 패턴을 따릅니다.
        /// </summary>
        private static void SubscribeComEvents()
        {
            if (_capture == null) return;

            try
            {
                // IConnectionPointContainer 가져오기
                var cpContainer = (IConnectionPointContainer)_capture;

                // 이벤트 인터페이스 GUID (IDL에서 확인: _IOnVoiceCaptureEvents)
                var eventIID = new Guid("52b4a16b-9f83-4a3e-9240-4dd6676540ea");

                // 직접 Connection Point 찾기
                IConnectionPoint? connectionPoint;
                cpContainer.FindConnectionPoint(ref eventIID, out connectionPoint);

                if (connectionPoint == null)
                {
                    Console.Error.WriteLine("[OnVoiceComBridge] Connection Point를 찾을 수 없습니다. EnumConnectionPoints를 시도합니다...");
                    
                    // Fallback: 모든 Connection Points 열거
                    IEnumConnectionPoints? enumConnectionPoints;
                    cpContainer.EnumConnectionPoints(out enumConnectionPoints);
                    
                    if (enumConnectionPoints == null)
                    {
                        Console.Error.WriteLine("[OnVoiceComBridge] Connection Points를 열거할 수 없습니다.");
                        return;
                    }

                    IConnectionPoint[] connectionPoints = new IConnectionPoint[1];
                    uint fetched = 0;

                    // 첫 번째 Connection Point 가져오기
                    enumConnectionPoints.Next(1, connectionPoints, out fetched);
                    
                    if (fetched == 0 || connectionPoints[0] == null)
                    {
                        Console.Error.WriteLine("[OnVoiceComBridge] Connection Point를 찾을 수 없습니다.");
                        return;
                    }

                    connectionPoint = connectionPoints[0];
                }

                _connectionPoint = connectionPoint;

                // 이벤트 싱크 생성
                var eventSink = new OnVoiceCaptureEventSink();

                // 이벤트 구독 (advise)
                _connectionPoint.Advise(eventSink, out _connectionCookie);

                Console.WriteLine($"[OnVoiceComBridge] COM 이벤트 구독 성공 (Cookie: {_connectionCookie})");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[OnVoiceComBridge] COM 이벤트 구독 실패: {ex.Message}");
                Console.Error.WriteLine($"[OnVoiceComBridge] 스택 트레이스: {ex.StackTrace}");
                
                // Dynamic을 통한 대체 방법 시도
                TrySubscribeEventsWithDynamic();
            }
        }

        /// <summary>
        /// Dynamic 객체를 통한 이벤트 구독 시도 (대체 방법)
        /// </summary>
        private static void TrySubscribeEventsWithDynamic()
        {
            if (_capture == null)
            {
                Console.Error.WriteLine("[OnVoiceComBridge] _capture가 null이어서 Dynamic 이벤트 구독을 시도할 수 없습니다.");
                return;
            }

            try
            {
                // Reflection을 사용하여 이벤트 찾기
                var captureType = _capture.GetType();
                var eventInfo = captureType.GetEvent("OnAudioData");
                
                if (eventInfo != null)
                {
                    // 이벤트 핸들러 생성
                    var handlerType = eventInfo.EventHandlerType;
                    var methodInfo = typeof(Startup).GetMethod("OnAudioDataHandler",
                        System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
                    
                    if (methodInfo != null)
                    {
                        var handler = Delegate.CreateDelegate(handlerType, methodInfo);
                        eventInfo.AddEventHandler(_capture, handler);
                        Console.WriteLine("[OnVoiceComBridge] COM 이벤트 구독 성공 (Reflection)");
                        return;
                    }
                }
                
                Console.WriteLine("[OnVoiceComBridge] WARN: Dynamic 이벤트 구독도 실패했습니다. COM 인터페이스를 확인하세요.");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[OnVoiceComBridge] Dynamic 이벤트 구독 실패: {ex.Message}");
            }
        }

        /// <summary>
        /// Called by COM when audio data is available.
        /// This method forwards PCM bytes to Node via the stored JS callback.
        /// 
        /// ⚠️ 실제 COM 이벤트 시그니처에 맞춰 이 메서드의 시그니처를 수정해야 할 수 있습니다.
        /// </summary>
        /// <param name="buffer">PCM audio data from COM (e.g., 16kHz mono)</param>
        internal static void OnAudioData(byte[] buffer)
        {
            // Null 체크
            if (buffer == null)
            {
                Console.Error.WriteLine("[OnVoiceComBridge] WARN: buffer가 null입니다!");
                return;
            }

            var cb = _audioCallback;
            if (cb == null)
            {
                Console.WriteLine("[OnVoiceComBridge] WARN: _audioCallback이 null입니다!");
                return;
            }

            try
            {
                // DEBUG: 반복 로그는 제거 (너무 많이 출력됨)
                // Console.WriteLine($"[OnVoiceComBridge] OnAudioData 호출됨: {buffer?.Length ?? 0} bytes");
                
                // Fire-and-forget: edge-js callback returns a Task<object>
                // JS side is responsible for handling the message and acknowledging via cb(null, res).
                // 비동기 작업의 예외를 처리하기 위해 ContinueWith 사용
                var task = cb(new
                {
                    type = "audio",
                    data = buffer
                });
                
                // 비동기 작업의 예외를 처리 (COM 스레드에서 호출되므로 안전하게 처리)
                if (task != null)
                {
                    task.ContinueWith(t =>
                    {
                        if (t.IsFaulted && t.Exception != null)
                        {
                            Console.Error.WriteLine($"[OnVoiceComBridge] 비동기 콜백 오류: {t.Exception.GetBaseException().Message}");
                            foreach (var innerEx in t.Exception.InnerExceptions)
                            {
                                Console.Error.WriteLine($"[OnVoiceComBridge] 내부 예외: {innerEx.Message}");
                            }
                        }
                    }, TaskContinuationOptions.OnlyOnFaulted);
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[OnVoiceComBridge] 콜백 호출 오류: {ex.Message}");
                Console.Error.WriteLine($"[OnVoiceComBridge] 스택 트레이스: {ex.StackTrace}");
            }
        }

        /// <summary>
        /// Reflection을 통한 이벤트 핸들러 (대체 방법용)
        /// </summary>
        private static void OnAudioDataHandler(object? sender, dynamic data)
        {
            try
            {
                byte[]? buffer = null;

                // 다양한 형태의 데이터를 byte[]로 변환
                if (data is byte[] bytes)
                {
                    buffer = bytes;
                }
                else if (data != null)
                {
                    // IntPtr이나 다른 형태일 수도 있음
                    // 실제 COM 이벤트 시그니처에 맞게 수정 필요
                    var dataType = data?.GetType();
                    Console.WriteLine($"[OnVoiceComBridge] WARN: 예상하지 못한 데이터 타입: {dataType?.Name ?? "null"}");
                }

                if (buffer != null)
                {
                    OnAudioData(buffer);
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[OnVoiceComBridge] OnAudioDataHandler 오류: {ex.Message}");
            }
        }
    }

    /// <summary>
    /// COM 이벤트 싱크 구현
    /// OnVoice COM 객체의 _IOnVoiceCaptureEvents 인터페이스를 구현합니다.
    /// GUID: 52b4a16b-9f83-4a3e-9240-4dd6676540ea (IDL에서 확인됨)
    /// 
    /// dispinterface를 구현하기 위해 IDispatch를 직접 구현합니다.
    /// </summary>
    [ComVisible(true)]
    [SupportedOSPlatform("windows")]
    [Guid("52b4a16b-9f83-4a3e-9240-4dd6676540ea")]
    [ClassInterface(ClassInterfaceType.None)] // 인터페이스를 통해서만 노출
    public class OnVoiceCaptureEventSink : IOnVoiceCaptureEvents
    {
        [DispId(1)] // IDL에서 [id(1)]로 정의됨
        public void OnAudioData(
            [MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_UI1)] 
            byte[] pcmData
        )
        {
            try
            {
                Startup.OnAudioData(pcmData);
            }
            catch (Exception ex)
            {
                // COM 스레드에서 호출되므로 예외를 잡아서 로그만 남기고 전파하지 않음
                // 예외를 전파하면 COM 객체에 문제가 생길 수 있음
                Console.Error.WriteLine($"[OnVoiceCaptureEventSink] OnAudioData 예외: {ex.Message}");
                Console.Error.WriteLine($"[OnVoiceCaptureEventSink] 스택 트레이스: {ex.StackTrace}");
            }
        }
    }

    /// <summary>
    /// COM Connection Point 관련 인터페이스
    /// </summary>
    [ComImport]
    [Guid("B196B284-BAB4-101A-B69C-00AA00341D07")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IConnectionPointContainer
    {
        void EnumConnectionPoints(out IEnumConnectionPoints? ppEnum);
        void FindConnectionPoint(ref Guid riid, out IConnectionPoint? ppCP);
    }

    [ComImport]
    [Guid("B196B285-BAB4-101A-B69C-00AA00341D07")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IEnumConnectionPoints
    {
        void Next(uint cConnections, IConnectionPoint[] rgpcn, out uint pcFetched);
        void Skip(uint cConnections);
        void Reset();
        void Clone(out IEnumConnectionPoints? ppEnum);
    }

    [ComImport]
    [Guid("B196B286-BAB4-101A-B69C-00AA00341D07")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IConnectionPoint
    {
        void GetConnectionInterface(out Guid pIID);
        void GetConnectionPointContainer(out IConnectionPointContainer? ppCPC);
        void Advise([MarshalAs(UnmanagedType.IUnknown)] object pUnkSink, out uint pdwCookie);
        void Unadvise(uint dwCookie);
        void EnumConnections(out IEnumConnections? ppEnum);
    }

    [ComImport]
    [Guid("B196B287-BAB4-101A-B69C-00AA00341D07")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IEnumConnections
    {
        void Next(uint cConnections, [Out] object[] rgcd, out uint pcFetched);
        void Skip(uint cConnections);
        void Reset();
        void Clone(out IEnumConnections? ppEnum);
    }

    /// <summary>
    /// OnVoice COM 이벤트 인터페이스
    /// GUID: 52b4a16b-9f83-4a3e-9240-4dd6676540ea (IDL _IOnVoiceCaptureEvents에서 확인됨)
    /// 
    /// IDL 정의:
    /// dispinterface _IOnVoiceCaptureEvents {
    ///   [id(1)] void OnAudioData([in] SAFEARRAY(unsigned char) pcmData);
    /// }
    /// 
    /// SAFEARRAY(unsigned char)는 C#에서 byte[]로 매핑됩니다.
    /// 
    /// 주의: [ComImport]가 아닌 일반 인터페이스로 정의하여 C#에서 구현 가능하도록 함
    /// </summary>
    [ComVisible(true)]
    [Guid("52b4a16b-9f83-4a3e-9240-4dd6676540ea")]
    [InterfaceType(ComInterfaceType.InterfaceIsIDispatch)] // dispinterface이므로 IDispatch
    public interface IOnVoiceCaptureEvents
    {
        [DispId(1)] // IDL에서 [id(1)]로 정의됨 - C++의 Invoke 호출 ID와 일치해야 함
        void OnAudioData(
            [MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_UI1)] 
            byte[] pcmData
        );
    }
}

