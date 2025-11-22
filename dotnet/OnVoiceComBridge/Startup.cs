using System;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Threading;
using System.Threading.Tasks;
using System.Reflection; 

namespace OnVoiceComBridge
{
    [SupportedOSPlatform("windows")]
    public class Startup
    {
        private static object? _capture;
        private static uint _connectionCookie = 0;
        private static IConnectionPoint? _connectionPoint;
        
        // ✅ [수정 1] GC가 수집하지 못하도록 클래스 레벨에 멤버 변수로 보관
        private static OnVoiceCaptureEventSink? _eventSink;
        
        private static Func<object, Task<object>>? _audioCallback;
        private static SynchronizationContext? _mainThreadContext;
        private static int _mainThreadId = -1;

        public async Task<object> Invoke(dynamic input)
        {
            string command = (string)input.command;

            switch (command)
            {
                case "init":
                    _audioCallback = (Func<object, Task<object>>)input.onAudioData;
                    _mainThreadContext = SynchronizationContext.Current ?? new SynchronizationContext();
                    if (SynchronizationContext.Current == null) SynchronizationContext.SetSynchronizationContext(_mainThreadContext);
                    _mainThreadId = Thread.CurrentThread.ManagedThreadId;
                    
                    Console.WriteLine($"[OnVoiceComBridge] 초기화 완료 (MainThreadId={_mainThreadId})");
                    EnsureComObject();
                    SubscribeComEvents();
                    return new { ok = true, source = "OnVoiceComBridge", action = "init" };

                case "start":
                    EnsureComObject();
                    if (_capture == null) throw new InvalidOperationException("COM object not initialized");
                    
                    int pid = 0;
                    try { pid = Convert.ToInt32(input.pid); } catch { throw new ArgumentException("PID 변환 실패"); }
                    
                    Console.WriteLine($"[OnVoiceComBridge] StartCapture 호출 시도: PID={pid}");
                    
                    try 
                    {
                        // IDL의 IOnVoiceCapture UUID 사용 (43a4...)
                        var capturer = (IOnVoiceCapture)_capture;
                        capturer.StartCapture(pid);
                        Console.WriteLine($"[OnVoiceComBridge] ✅ StartCapture 성공 (Interface Casting)");
                    }
                    catch (Exception ex)
                    {
                         Console.Error.WriteLine($"[OnVoiceComBridge] ❌ StartCapture 오류: {ex.Message}");
                         // 혹시 모르니 Reflection 시도
                         try {
                            _capture.GetType().InvokeMember("StartCapture", BindingFlags.InvokeMethod, null, _capture, new object[] { pid });
                         } catch { throw; }
                    }
                    return new { ok = true, pid };

                case "stop":
                    if (_capture != null)
                    {
                        try
                        {
                            var capturer = (IOnVoiceCapture)_capture;
                            capturer.StopCapture();
                            Console.WriteLine($"[OnVoiceComBridge] ✅ StopCapture 성공");
                        }
                        catch { }
                    }
                    return new { ok = true };

                case "find":
                    EnsureComObject();
                    if (_capture == null) throw new InvalidOperationException("COM object not initialized");
                    
                    string target = (string)input.target;
                    Console.WriteLine($"[OnVoiceComBridge] 프로세스 찾기 요청: {target}");
                    
                    int foundPid = 0;
                    
                    try
                    {
                        var capturer = (IOnVoiceCapture)_capture;
                        
                        switch (target?.ToLower())
                        {
                            case "chrome":
                                foundPid = capturer.FindChromeProcess();
                                Console.WriteLine($"[OnVoiceComBridge] ✅ FindChromeProcess 성공: PID={foundPid}");
                                break;
                            case "edge":
                                foundPid = capturer.FindEdgeProcess();
                                Console.WriteLine($"[OnVoiceComBridge] ✅ FindEdgeProcess 성공: PID={foundPid}");
                                break;
                            case "discord":
                                foundPid = capturer.FindDiscordProcess();
                                Console.WriteLine($"[OnVoiceComBridge] ✅ FindDiscordProcess 성공: PID={foundPid}");
                                break;
                            default:
                                return new { ok = false, error = $"Unknown target: {target}" };
                        }
                        
                        if (foundPid <= 0)
                        {
                            return new { ok = false, error = $"프로세스를 찾을 수 없습니다: {target}" };
                        }
                        
                        return new { ok = true, pid = foundPid };
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine($"[OnVoiceComBridge] ❌ 프로세스 찾기 오류: {ex.Message}");
                        // Reflection 시도
                        try
                        {
                            string methodName = target?.ToLower() switch
                            {
                                "chrome" => "FindChromeProcess",
                                "edge" => "FindEdgeProcess",
                                "discord" => "FindDiscordProcess",
                                _ => throw new ArgumentException($"Unknown target: {target}")
                            };
                            
                            object? result = _capture.GetType().InvokeMember(methodName, BindingFlags.InvokeMethod, null, _capture, null);
                            foundPid = result != null ? Convert.ToInt32(result) : 0;
                            
                            if (foundPid <= 0)
                            {
                                return new { ok = false, error = $"프로세스를 찾을 수 없습니다: {target}" };
                            }
                            
                            Console.WriteLine($"[OnVoiceComBridge] ✅ {methodName} 성공 (Reflection): PID={foundPid}");
                            return new { ok = true, pid = foundPid };
                        }
                        catch (Exception refEx)
                        {
                            Console.Error.WriteLine($"[OnVoiceComBridge] ❌ Reflection 시도 실패: {refEx.Message}");
                            return new { ok = false, error = $"프로세스 찾기 실패: {ex.Message}" };
                        }
                    }

                default:
                    return new { ok = false, error = $"Unknown command: {command}" };
            }
        }

        private static void EnsureComObject()
        {
            if (_capture != null) return;
            const string progId = "OnVoiceAudioBridge.OnVoiceCapture"; 
            Type t = Type.GetTypeFromProgID(progId, throwOnError: true) ?? throw new InvalidOperationException($"COM ProgID not found: {progId}");
            _capture = Activator.CreateInstance(t) ?? throw new InvalidOperationException($"Failed to create instance: {progId}");
        }

        private static void SubscribeComEvents()
        {
            if (_capture == null) return;
            if (_connectionPoint != null) return; // 이미 구독 중이면 패스

            try
            {
                var cpContainer = (IConnectionPointContainer)_capture;
                
                // 이벤트용 GUID (52b4...)
                var eventIID = new Guid("52b4a16b-9f83-4a3e-9240-4dd6676540ea"); 

                IConnectionPoint? connectionPoint;
                cpContainer.FindConnectionPoint(ref eventIID, out connectionPoint);

                if (connectionPoint == null)
                {
                    Console.Error.WriteLine("[OnVoiceComBridge] ConnectionPoint를 찾을 수 없습니다.");
                    return;
                }

                _connectionPoint = connectionPoint;
                
                // ✅ [수정 2] 멤버 변수에 할당 (GC 방지)
                _eventSink = new OnVoiceCaptureEventSink();
                
                // ✅ [수정 3] 수동 마샬링 (IntPtr 사용) - AccessViolation 해결의 핵심!
                // C# 객체를 순수 IUnknown 포인터로 변환
                IntPtr pUnkSink = Marshal.GetIUnknownForObject(_eventSink);
                
                try
                {
                    _connectionPoint.Advise(pUnkSink, out _connectionCookie);
                    Console.WriteLine($"[OnVoiceComBridge] COM 이벤트 구독 성공 (Cookie: {_connectionCookie})");
                }
                finally
                {
                    // GetIUnknownForObject는 RefCount를 +1 하므로, 
                    // Advise가 내부적으로 또 +1을 했다면 여기서 -1 해주는 것이 정석입니다.
                    // 하지만 Advise가 실패해서 터지는 경우를 대비해 finally에 둡니다.
                    if (pUnkSink != IntPtr.Zero)
                    {
                        Marshal.Release(pUnkSink);
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[OnVoiceComBridge] 이벤트 구독 실패 (AccessViolation 등): {ex.Message}");
            }
        }

        internal static void OnAudioData(byte[] buffer)
        {
            if (buffer == null || _audioCallback == null) return;
            var cb = _audioCallback;
            var ctx = _mainThreadContext;
            var callId = Interlocked.Increment(ref _onAudioDataCallCount);

            if (Thread.CurrentThread.ManagedThreadId != _mainThreadId && ctx != null)
                ctx.Post(_ => InvokeJs(cb, buffer), null);
            else
                InvokeJs(cb, buffer);
        }
        
        private static int _onAudioDataCallCount = 0;
        private static void InvokeJs(Func<object, Task<object>> cb, byte[] buffer)
        {
             try { cb(new { type = "audio", data = buffer }); } catch { }
        }
    }

    // 메인 인터페이스 (IOnVoiceCapture) - IDL UUID: 43a4...
    [ComImport]
    [Guid("43a468da-7889-46c9-99de-38cb93e4e649")]
    [InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IOnVoiceCapture
    {
        [DispId(1)] void StartCapture(int pid);
        [DispId(2)] void StopCapture();
        [DispId(3)] int GetCaptureState();
        [DispId(4)] int FindChromeProcess();
        [DispId(5)] int FindEdgeProcess();
        [DispId(6)] int FindDiscordProcess();
    }

    // 이벤트 수신용 싱크 - IDL UUID: 52b4...
    [ComVisible(true)]
    [Guid("52b4a16b-9f83-4a3e-9240-4dd6676540ea")]
    [ClassInterface(ClassInterfaceType.None)]
    public class OnVoiceCaptureEventSink : IOnVoiceCaptureEvents
    {
        [DispId(1)]
        public void OnAudioData([MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_UI1)] byte[] pcmData)
        {
            Startup.OnAudioData(pcmData);
        }
    }

    // --- COM 기본 인터페이스 ---
    [ComImport, Guid("B196B284-BAB4-101A-B69C-00AA00341D07"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IConnectionPointContainer 
    { 
        void EnumConnectionPoints(out IEnumConnectionPoints? ppEnum); 
        void FindConnectionPoint(ref Guid riid, out IConnectionPoint? ppCP); 
    }
    
    [ComImport, Guid("B196B285-BAB4-101A-B69C-00AA00341D07"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IEnumConnectionPoints { void Next(uint c, IConnectionPoint[] r, out uint f); void Skip(uint c); void Reset(); void Clone(out IEnumConnectionPoints? p); }
    
    // ✅ [수정 4] IConnectionPoint 정의 수정 (Advise 매개변수를 IntPtr로 변경)
    [ComImport, Guid("B196B286-BAB4-101A-B69C-00AA00341D07"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IConnectionPoint 
    { 
        void GetConnectionInterface(out Guid p); 
        void GetConnectionPointContainer(out IConnectionPointContainer? p); 
        
        // object -> IntPtr로 변경하여 수동 마샬링 강제
        void Advise(IntPtr pUnkSink, out uint pdwCookie); 
        
        void Unadvise(uint c); 
        void EnumConnections(out object? p); 
    }

    [ComVisible(true), Guid("52b4a16b-9f83-4a3e-9240-4dd6676540ea"), InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IOnVoiceCaptureEvents { [DispId(1)] void OnAudioData([MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_UI1)] byte[] pcmData); }
}