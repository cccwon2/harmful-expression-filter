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
                    
                    // ✅ 1. 메인 인터페이스 캐스팅 (IDL의 IOnVoiceCapture UUID 사용)
                    try 
                    {
                        var capturer = (IOnVoiceCapture)_capture;
                        capturer.StartCapture(pid);
                        Console.WriteLine($"[OnVoiceComBridge] ✅ StartCapture 성공 (Interface Casting)");
                        return new { ok = true, pid };
                    }
                    catch (InvalidCastException)
                    {
                        // 혹시라도 실패하면 Reflection 시도 (비상용)
                        Console.WriteLine("[OnVoiceComBridge] ⚠️ 인터페이스 캐스팅 실패. Reflection으로 재시도합니다.");
                    }
                    catch (Exception ex)
                    {
                         Console.Error.WriteLine($"[OnVoiceComBridge] ❌ StartCapture 캐스팅 중 오류: {ex.Message}");
                         throw;
                    }

                    // 2. Reflection 기반 호출 (Fallback)
                    try
                    {
                        _capture.GetType().InvokeMember(
                            "StartCapture",
                            BindingFlags.InvokeMethod | BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase,
                            null,
                            _capture,
                            new object[] { pid }
                        );
                        Console.WriteLine($"[OnVoiceComBridge] ✅ StartCapture 성공 (Reflection)");
                        return new { ok = true, pid };
                    }
                    catch (Exception ex)
                    {
                        throw new InvalidOperationException($"StartCapture 호출 실패: {ex.Message}");
                    }

                case "stop":
                    if (_capture != null)
                    {
                        try
                        {
                            var capturer = (IOnVoiceCapture)_capture;
                            capturer.StopCapture();
                            Console.WriteLine($"[OnVoiceComBridge] ✅ StopCapture 성공");
                        }
                        catch
                        {
                            // Stop 실패는 무시 (프로그램 종료 시점 등에서 발생 가능)
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
            Type t = Type.GetTypeFromProgID(progId, throwOnError: true) ?? throw new InvalidOperationException($"COM ProgID not found: {progId}");
            _capture = Activator.CreateInstance(t) ?? throw new InvalidOperationException($"Failed to create instance: {progId}");
        }

        private static void SubscribeComEvents()
        {
            if (_capture == null) return;
            try
            {
                var cpContainer = (IConnectionPointContainer)_capture;
                
                // ✅ [수정됨] 이벤트용 GUID 사용 (IDL의 _IOnVoiceCaptureEvents UUID)
                // 52b4a16b-9f83-4a3e-9240-4dd6676540ea
                var eventIID = new Guid("52b4a16b-9f83-4a3e-9240-4dd6676540ea"); 

                IConnectionPoint? connectionPoint;
                cpContainer.FindConnectionPoint(ref eventIID, out connectionPoint);

                if (connectionPoint == null) return;

                _connectionPoint = connectionPoint;
                var eventSink = new OnVoiceCaptureEventSink();
                _connectionPoint.Advise(eventSink, out _connectionCookie);
                Console.WriteLine($"[OnVoiceComBridge] COM 이벤트 구독 성공 (GUID: {eventIID})");
            }
            catch (Exception ex) { Console.Error.WriteLine($"[OnVoiceComBridge] 이벤트 구독 실패: {ex.Message}"); }
        }

        internal static void OnAudioData(byte[] buffer)
        {
            if (buffer == null || _audioCallback == null) return;
            
            var cb = _audioCallback;
            var ctx = _mainThreadContext;
            
            // 간단한 호출 카운트 (로그 폭주 방지용)
            var callId = Interlocked.Increment(ref _onAudioDataCallCount);

            if (Thread.CurrentThread.ManagedThreadId != _mainThreadId && ctx != null)
            {
                ctx.Post(_ => InvokeJs(cb, buffer), null);
            }
            else
            {
                InvokeJs(cb, buffer);
            }
        }
        
        private static int _onAudioDataCallCount = 0;
        private static void InvokeJs(Func<object, Task<object>> cb, byte[] buffer)
        {
             try { cb(new { type = "audio", data = buffer }); } catch { }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 👇 [수정됨] 메인 기능용 인터페이스 (IOnVoiceCapture)
    // IDL UUID: 43a468da-7889-46c9-99de-38cb93e4e649
    // ─────────────────────────────────────────────────────────────
    [ComImport]
    [Guid("43a468da-7889-46c9-99de-38cb93e4e649")] // ✅ 여기가 핵심 수정 포인트!
    [InterfaceType(ComInterfaceType.InterfaceIsIDispatch)] // dual 인터페이스이므로 IDispatch 호환
    public interface IOnVoiceCapture
    {
        [DispId(1)] void StartCapture(int pid);
        [DispId(2)] void StopCapture();
        [DispId(3)] int GetCaptureState();
        // 필요한 경우 FindChromeProcess 등 추가 가능
    }

    // ─────────────────────────────────────────────────────────────
    // 👇 이벤트 수신용 싱크 (_IOnVoiceCaptureEvents)
    // IDL UUID: 52b4a16b-9f83-4a3e-9240-4dd6676540ea
    // ─────────────────────────────────────────────────────────────
    [ComVisible(true)]
    [Guid("52b4a16b-9f83-4a3e-9240-4dd6676540ea")] // ✅ 이벤트용 GUID 유지
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
    internal interface IConnectionPointContainer { void EnumConnectionPoints(out IEnumConnectionPoints? ppEnum); void FindConnectionPoint(ref Guid riid, out IConnectionPoint? ppCP); }
    
    [ComImport, Guid("B196B285-BAB4-101A-B69C-00AA00341D07"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IEnumConnectionPoints { void Next(uint c, IConnectionPoint[] r, out uint f); void Skip(uint c); void Reset(); void Clone(out IEnumConnectionPoints? p); }
    
    [ComImport, Guid("B196B286-BAB4-101A-B69C-00AA00341D07"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IConnectionPoint { void GetConnectionInterface(out Guid p); void GetConnectionPointContainer(out IConnectionPointContainer? p); void Advise(object s, out uint c); void Unadvise(uint c); void EnumConnections(out object? p); }

    // 이벤트 인터페이스 정의
    [ComVisible(true), Guid("52b4a16b-9f83-4a3e-9240-4dd6676540ea"), InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IOnVoiceCaptureEvents { [DispId(1)] void OnAudioData([MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_UI1)] byte[] pcmData); }
}