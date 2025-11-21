using System;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Threading;
using System.Threading.Tasks;
using System.Reflection; // Reflection은 일부 내부 로직에서만 사용

namespace OnVoiceComBridge
{
    /// <summary>
    /// Entry point class for electron-edge-js.
    /// Node/Electron에서는 StartCapture(pid) / StopCapture + audio 이벤트 스트림만 신경 쓰면 됩니다.
    /// </summary>
    [SupportedOSPlatform("windows")]
    public class Startup
    {
        // COM capture object
        private static object? _capture;

        // Connection Point Cookie (for unadvise)
        private static uint _connectionCookie = 0;
        private static IConnectionPoint? _connectionPoint;

        // JS callback passed from Node (edge-js marshalling)
        private static Func<object, Task<object>>? _audioCallback;
        
        // 메인 스레드의 SynchronizationContext (edge-js가 실행되는 스레드)
        private static SynchronizationContext? _mainThreadContext;
        private static int _mainThreadId = -1;

        public async Task<object> Invoke(dynamic input)
        {
            string command = (string)input.command;

            switch (command)
            {
                case "init":
                    _audioCallback = (Func<object, Task<object>>)input.onAudioData;
                    
                    _mainThreadContext = SynchronizationContext.Current;
                    _mainThreadId = Thread.CurrentThread.ManagedThreadId;
                    
                    if (_mainThreadContext == null)
                    {
                        _mainThreadContext = new SynchronizationContext();
                        SynchronizationContext.SetSynchronizationContext(_mainThreadContext);
                    }
                    
                    Console.WriteLine($"[OnVoiceComBridge] 초기화 완료 (MainThreadId={_mainThreadId})");

                    EnsureComObject();
                    SubscribeComEvents();

                    return new { ok = true, source = "OnVoiceComBridge", action = "init" };

                case "start":
                    EnsureComObject();
                    if (_capture == null)
                        throw new InvalidOperationException("COM object not initialized");
                    
                    int pid = 0;
                    try
                    {
                        // PID 추출 로직
                        var pidValue = input.pid;
                        if (pidValue is int intPid) pid = intPid;
                        else if (pidValue is long longPid) pid = (int)longPid;
                        else if (pidValue is double doublePid) pid = (int)doublePid;
                        else pid = Convert.ToInt32(pidValue);
                    }
                    catch (Exception ex)
                    {
                        throw new ArgumentException($"PID를 추출할 수 없습니다: {ex.Message}", ex);
                    }
                    
                    if (pid <= 0) throw new ArgumentException($"유효하지 않은 PID: {pid}");
                    
                    Console.WriteLine($"[OnVoiceComBridge] StartCapture 호출 시도: PID={pid}");
                    
                    // ✅ [수정됨] Reflection 제거 -> 인터페이스 캐스팅 사용
                    try 
                    {
                        // IOnVoiceCapture 인터페이스로 캐스팅하여 호출
                        // 43a468da-7889-46c9-99de-38cb93e4e649 GUID를 사용
                        var capturer = (IOnVoiceCapture)_capture;
                        capturer.StartCapture(pid);
                        
                        Console.WriteLine($"[OnVoiceComBridge] ✅ StartCapture 성공: PID={pid}");
                    }
                    catch (InvalidCastException)
                    {
                        // GUID가 맞지 않거나 인터페이스를 지원하지 않는 경우
                        throw new InvalidOperationException("COM 객체를 IOnVoiceCapture로 캐스팅할 수 없습니다. GUID 설정을 확인하세요.");
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine($"[OnVoiceComBridge] ❌ StartCapture 호출 실패: {ex.Message}");
                        throw;
                    }
                    
                    return new { ok = true, pid };

                case "stop":
                    if (_capture != null)
                    {
                        // ✅ [수정됨] Reflection 제거 -> 인터페이스 캐스팅 사용
                        try
                        {
                            var capturer = (IOnVoiceCapture)_capture;
                            capturer.StopCapture();
                            Console.WriteLine($"[OnVoiceComBridge] ✅ StopCapture 성공");
                        }
                        catch (Exception ex)
                        {
                            Console.Error.WriteLine($"[OnVoiceComBridge] StopCapture 실패: {ex.Message}");
                            // Stop 실패는 치명적이지 않을 수 있으므로 로그만 남김
                        }
                    }
                    return new { ok = true };

                default:
                    return new { ok = false, error = $"Unknown command: {command}" };
            }
        }

        private static void EnsureComObject()
        {
            if (_capture != null) return;

            const string progId = "OnVoiceAudioBridge.OnVoiceCapture";
            Type t = Type.GetTypeFromProgID(progId, throwOnError: true)
                      ?? throw new InvalidOperationException($"COM ProgID not found: {progId}");

            _capture = Activator.CreateInstance(t)
                       ?? throw new InvalidOperationException($"Failed to create COM instance: {progId}");
        }

        private static void SubscribeComEvents()
        {
            if (_capture == null) return;

            try
            {
                var cpContainer = (IConnectionPointContainer)_capture;
                
                // 이벤트 인터페이스 GUID (IOnVoiceCaptureEvents)
                // 여기서는 사용자가 제공한 GUID가 메인 인터페이스와 이벤트 인터페이스 모두에 쓰이는 것으로 가정
                // (만약 다르다면 별도로 분리해야 함)
                var eventIID = new Guid("43a468da-7889-46c9-99de-38cb93e4e649");

                IConnectionPoint? connectionPoint;
                cpContainer.FindConnectionPoint(ref eventIID, out connectionPoint);

                if (connectionPoint == null)
                {
                    Console.Error.WriteLine("[OnVoiceComBridge] FindConnectionPoint 실패. EnumConnectionPoints 시도...");
                    IEnumConnectionPoints? enumCP;
                    cpContainer.EnumConnectionPoints(out enumCP);
                    if (enumCP != null)
                    {
                        IConnectionPoint[] cps = new IConnectionPoint[1];
                        uint fetched = 0;
                        enumCP.Next(1, cps, out fetched);
                        if (fetched > 0) connectionPoint = cps[0];
                    }
                }

                if (connectionPoint == null)
                {
                    Console.Error.WriteLine("[OnVoiceComBridge] Connection Point를 찾을 수 없습니다.");
                    return;
                }

                _connectionPoint = connectionPoint;
                var eventSink = new OnVoiceCaptureEventSink();
                _connectionPoint.Advise(eventSink, out _connectionCookie);

                Console.WriteLine($"[OnVoiceComBridge] COM 이벤트 구독 성공 (Cookie: {_connectionCookie})");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[OnVoiceComBridge] COM 이벤트 구독 실패: {ex.Message}");
            }
        }

        // 내부 오디오 데이터 처리 핸들러
        private static int _onAudioDataCallCount = 0;
        internal static void OnAudioData(byte[] buffer)
        {
            var callId = Interlocked.Increment(ref _onAudioDataCallCount);
            
            if (buffer == null || _audioCallback == null) return;

            try
            {
                var currentThreadId = Thread.CurrentThread.ManagedThreadId;
                bool isMain = (currentThreadId == _mainThreadId);

                if (!isMain && _mainThreadContext != null)
                {
                    _mainThreadContext.Post(_ => InvokeJavaScriptCallback(_audioCallback, buffer, callId), null);
                }
                else
                {
                    InvokeJavaScriptCallback(_audioCallback, buffer, callId);
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[OnVoiceComBridge] Callback Error: {ex.Message}");
            }
        }
        
        private static void InvokeJavaScriptCallback(Func<object, Task<object>> cb, byte[] buffer, int callId)
        {
            try
            {
                var task = cb(new { type = "audio", data = buffer });
                
                if (task != null)
                {
                    task.ContinueWith(t =>
                    {
                        if (t.IsFaulted && t.Exception != null)
                        {
                            Console.Error.WriteLine($"[OnVoiceComBridge] JS Callback Error: {t.Exception.GetBaseException().Message}");
                        }
                    }, TaskContinuationOptions.OnlyOnFaulted);
                }
            }
            catch { /* Ignore sync errors */ }
        }
    }

    /// <summary>
    /// ✅ [핵심 수정] StartCapture/StopCapture 호출을 위한 메인 인터페이스 정의
    /// 제공된 GUID 사용: 43a468da-7889-46c9-99de-38cb93e4e649
    /// </summary>
    [ComImport]
    [Guid("43a468da-7889-46c9-99de-38cb93e4e649")]
    [InterfaceType(ComInterfaceType.InterfaceIsIDispatch)] // Dispatch 인터페이스로 가정
    public interface IOnVoiceCapture
    {
        // DispId는 COM 서버(C++)의 IDL 정의 순서에 따라 다를 수 있습니다.
        // 보통 1번부터 시작하거나, 메서드 선언 순서를 따릅니다.
        // 만약 "Method not found" 에러가 나면 DispId(1), DispId(2) 순서를 바꿔보거나 확인이 필요합니다.
        
        [DispId(1)] // StartCapture가 첫 번째 메서드라고 가정
        void StartCapture(int pid);

        [DispId(2)] // StopCapture가 두 번째 메서드라고 가정
        void StopCapture();
    }

    /// <summary>
    /// COM 이벤트 싱크 구현 (기존 코드 유지)
    /// </summary>
    [ComVisible(true)]
    [SupportedOSPlatform("windows")]
    [Guid("43a468da-7889-46c9-99de-38cb93e4e649")] // 이벤트 인터페이스 GUID
    [ClassInterface(ClassInterfaceType.None)]
    public class OnVoiceCaptureEventSink : IOnVoiceCaptureEvents
    {
        [DispId(1)]
        public void OnAudioData([MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_UI1)] byte[] pcmData)
        {
            Startup.OnAudioData(pcmData);
        }
    }

    // --- 이하 COM 기본 인터페이스 정의 (변경 없음) ---

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

    [ComVisible(true)]
    [Guid("43a468da-7889-46c9-99de-38cb93e4e649")]
    [InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IOnVoiceCaptureEvents
    {
        [DispId(1)]
        void OnAudioData([MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_UI1)] byte[] pcmData);
    }
}