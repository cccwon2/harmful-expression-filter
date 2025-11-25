using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Threading;
using System.Threading.Tasks;
using System.Reflection;
using System.Drawing; 
using System.Drawing.Imaging;
using System.IO;
using System.Diagnostics;

// Windows API (WinRT)
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;
using Windows.Media.Ocr; 
using Windows.Globalization;

// NAudio for volume control
using NAudio.CoreAudioApi;

namespace OnVoiceComBridge
{
    [SupportedOSPlatform("windows10.0.19041.0")]
    public class Startup
    {
        private static object? _capture;
        private static uint _connectionCookie = 0;
        private static IConnectionPoint? _connectionPoint;
        private static OnVoiceCaptureEventSink? _eventSink;
        
        private static Func<object, Task<object>>? _audioCallback;
        private static SynchronizationContext? _mainThreadContext;
        private static int _mainThreadId = -1;
        
        private static OcrEngine? _ocrEngine;
        
        static Startup()
        {
            // Windows SDK 런타임 DLL 로드를 위한 AssemblyResolve 이벤트 핸들러
            AppDomain.CurrentDomain.AssemblyResolve += OnAssemblyResolve;
        }

        private static System.Reflection.Assembly? OnAssemblyResolve(object? sender, ResolveEventArgs args)
        {
            string assemblyName = new System.Reflection.AssemblyName(args.Name).Name ?? "";
            
            // Windows SDK 런타임 DLL 찾기
            if (assemblyName == "Microsoft.Windows.SDK.NET" || assemblyName == "WinRT.Runtime")
            {
                // .NET 런타임 팩 경로에서 찾기
                string? dotnetRoot = Environment.GetEnvironmentVariable("DOTNET_ROOT") ?? 
                                    Environment.GetEnvironmentVariable("ProgramFiles") + @"\dotnet";
                string[] searchPaths = new[]
                {
                    Path.Combine(dotnetRoot, "packs", "Microsoft.Windows.SDK.NET.Ref", "10.0.19041.52", "ref", "net6.0"),
                    Path.Combine(dotnetRoot, "packs", "Microsoft.Windows.SDK.NET.Ref", "10.0.19041.52", "ref"),
                    Path.Combine(dotnetRoot, "shared", "Microsoft.WindowsDesktop.App", "6.0.0"),
                };

                foreach (string searchPath in searchPaths)
                {
                    if (!Directory.Exists(searchPath)) continue;
                    
                    string dllPath = Path.Combine(searchPath, assemblyName + ".dll");
                    if (File.Exists(dllPath))
                    {
                        try
                        {
                            return System.Reflection.Assembly.LoadFrom(dllPath);
                        }
                        catch { }
                    }
                }

                // 현재 어셈블리 디렉토리에서 찾기
                string? currentDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                if (!string.IsNullOrEmpty(currentDir))
                {
                    string localPath = Path.Combine(currentDir, assemblyName + ".dll");
                    if (File.Exists(localPath))
                    {
                        try
                        {
                            return System.Reflection.Assembly.LoadFrom(localPath);
                        }
                        catch { }
                    }
                }
            }

            return null;
        }

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
                        var capturer = (IOnVoiceCapture)_capture;
                        capturer.StartCapture(pid);
                        Console.WriteLine($"[OnVoiceComBridge] ✅ StartCapture 성공");
                    }
                    catch (Exception ex)
                    {
                         Console.Error.WriteLine($"[OnVoiceComBridge] ❌ StartCapture 오류: {ex.Message}");
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
                    
                    int foundPid = 0;
                    try
                    {
                        var capturer = (IOnVoiceCapture)_capture;
                        switch (target?.ToLower())
                        {
                            case "chrome": foundPid = capturer.FindChromeProcess(); break;
                            case "edge": foundPid = capturer.FindEdgeProcess(); break;
                            case "discord": foundPid = capturer.FindDiscordProcess(); break;
                            default: return new { ok = false, error = $"Unknown target: {target}" };
                        }
                        
                        if (foundPid <= 0) return new { ok = false, error = $"프로세스를 찾을 수 없습니다: {target}" };
                        
                        Console.WriteLine($"[OnVoiceComBridge] ✅ {target} 찾기 성공: PID={foundPid}");
                        return new { ok = true, pid = foundPid };
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine($"[OnVoiceComBridge] ❌ 프로세스 찾기 오류: {ex.Message}");
                        return new { ok = false, error = ex.Message };
                    }

                case "ocr":
                    try
                    {
                        var ocrStartTime = DateTime.UtcNow;
                        byte[] imageBytes = (byte[])input.imageData;
                        
                        SoftwareBitmap? softwareBitmap = await ConvertBytesToSoftwareBitmap(imageBytes);
                        if (softwareBitmap == null) return new { ok = false, error = "이미지 변환 실패" };
                        
                        string recognizedText = await RecognizeTextFromSoftwareBitmap(softwareBitmap);
                        var ocrEndTime = DateTime.UtcNow;
                        var ocrTime = (ocrEndTime - ocrStartTime).TotalSeconds;
                        
                        Console.WriteLine($"[OnVoiceComBridge] OCR 완료: {recognizedText.Length}자 추출 ({ocrTime:F3}초)");
                        
                        var texts = SplitTextToLines(recognizedText);
                        
                        return new { 
                            ok = true, 
                            texts = texts,
                            text = recognizedText,
                            confidence = 0.0, 
                            processing_time = new { ocr = ocrTime, analysis = 0.0, total = ocrTime }
                        };
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine($"[OnVoiceComBridge] ❌ OCR 오류: {ex.Message}");
                        return new { ok = false, error = ex.Message };
                    }

                case "ocrAndBlur":
                    try
                    {
                        // Node.js에서 유해 표현 분석을 수행하므로, 이 메서드는
                        // OCR 텍스트만 반환하고 blur는 별도 "blur" 명령에서 처리합니다.
                        
                        byte[] imageBytes = (byte[])input.imageData;
                        
                        SoftwareBitmap? softwareBitmap = await ConvertBytesToSoftwareBitmap(imageBytes);
                        if (softwareBitmap == null) return new { ok = false, error = "이미지 변환 실패" };
                        
                        string recognizedText = await RecognizeTextFromSoftwareBitmap(softwareBitmap);
                        var texts = SplitTextToLines(recognizedText);
                        
                        // 서버 분석 제거됨
                        
                        return new { 
                            ok = true, 
                            texts = texts,
                            text = recognizedText,
                            is_harmful = false, // Node.js에서 판단
                            harmful_words = new string[0],
                            confidence = 0.0,
                            blurredImage = (byte[]?)null // 블러 처리는 Node.js 요청 시 수행하거나 별도 명령으로 이동
                        };
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine($"[OnVoiceComBridge] ❌ OCR 오류: {ex.Message}");
                        return new { ok = false, error = ex.Message };
                    }
                
                // 블러 처리 전용 명령 추가 (필요 시 Node.js에서 호출)
                case "blur":
                    try 
                    {
                        byte[] imageBytes = (byte[])input.imageData;
                        var roi = input.roi;
                        int roiX = Convert.ToInt32(roi.x);
                        int roiY = Convert.ToInt32(roi.y);
                        int roiWidth = Convert.ToInt32(roi.width);
                        int roiHeight = Convert.ToInt32(roi.height);
                        
                        byte[] blurredImage = await BlurROI(imageBytes, roiX, roiY, roiWidth, roiHeight);
                        return new { ok = true, blurredImage };
                    }
                    catch (Exception ex)
                    {
                        return new { ok = false, error = ex.Message };
                    }

                case "setVolume":
                    return SetApplicationVolume(input);

                case "listSessions":
                    return ListAudioSessions();

                default:
                    return new { ok = false, error = $"Unknown command: {command}" };
            }
        }

        private static void EnsureOcrEngine()
        {
            if (_ocrEngine != null) return;
            _ocrEngine = OcrEngine.TryCreateFromUserProfileLanguages();
            if (_ocrEngine == null)
            {
                var lang = new Language("en-US");
                if (OcrEngine.IsLanguageSupported(lang)) _ocrEngine = OcrEngine.TryCreateFromLanguage(lang);
            }
            if (_ocrEngine == null) throw new InvalidOperationException("OCR 엔진 생성 실패.");
        }

        public static async Task<string> RecognizeTextFromSoftwareBitmap(SoftwareBitmap bitmap)
        {
            EnsureOcrEngine();
            if (bitmap.BitmapPixelFormat != BitmapPixelFormat.Bgra8)
            {
                bitmap = SoftwareBitmap.Convert(bitmap, BitmapPixelFormat.Bgra8);
            }
            var result = await _ocrEngine!.RecognizeAsync(bitmap);
            return result.Text; 
        }

        // ✅ [핵심 수정] DataWriter를 사용하여 AsBuffer() 없이 구현
        private static async Task<SoftwareBitmap?> ConvertBytesToSoftwareBitmap(byte[] imageBytes)
        {
            try
            {
                using (var stream = new InMemoryRandomAccessStream())
                {
                    // DataWriter를 사용하여 byte[]를 WinRT 스트림에 씁니다.
                    using (var writer = new DataWriter(stream.GetOutputStreamAt(0)))
                    {
                        writer.WriteBytes(imageBytes);
                        await writer.StoreAsync();
                    }

                    // 스트림을 다시 디코딩
                    var decoder = await BitmapDecoder.CreateAsync(stream);
                    return await decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied);
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[OnVoiceComBridge] 이미지 변환 오류: {ex.Message}");
                return null;
            }
        }
        
        private static string[] SplitTextToLines(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return Array.Empty<string>();
            var list = new List<string>();
            var lines = text.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (var line in lines)
            {
                var trimmed = line.Trim();
                if (!string.IsNullOrWhiteSpace(trimmed)) list.Add(trimmed);
            }
            return list.ToArray();
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
            if (_connectionPoint != null) return;

            try
            {
                var cpContainer = (IConnectionPointContainer)_capture;
                var eventIID = new Guid("52b4a16b-9f83-4a3e-9240-4dd6676540ea"); 
                IConnectionPoint? connectionPoint;
                cpContainer.FindConnectionPoint(ref eventIID, out connectionPoint);

                if (connectionPoint == null) return;

                _connectionPoint = connectionPoint;
                _eventSink = new OnVoiceCaptureEventSink();
                IntPtr pUnkSink = Marshal.GetIUnknownForObject(_eventSink);
                
                try
                {
                    _connectionPoint.Advise(pUnkSink, out _connectionCookie);
                    Console.WriteLine($"[OnVoiceComBridge] COM 이벤트 구독 성공 (Cookie: {_connectionCookie})");
                }
                finally
                {
                    if (pUnkSink != IntPtr.Zero) Marshal.Release(pUnkSink);
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[OnVoiceComBridge] 이벤트 구독 실패: {ex.Message}");
            }
        }

        internal static void OnAudioData(byte[] buffer)
        {
            if (buffer == null || _audioCallback == null) return;
            
            // [DEBUG] 오디오 데이터 수신 시각 로깅
            // Console.WriteLine($"[OnVoiceComBridge] Audio Data Recv: {buffer.Length} bytes at {DateTime.UtcNow:HH:mm:ss.fff}");

            var cb = _audioCallback;
            var ctx = _mainThreadContext;

            if (Thread.CurrentThread.ManagedThreadId != _mainThreadId && ctx != null)
                ctx.Post(_ => InvokeJs(cb, buffer), null);
            else
                InvokeJs(cb, buffer);
        }
        
        private static void InvokeJs(Func<object, Task<object>> cb, byte[] buffer)
        {
             try { 
                // 타임스탬프 추가 (Unix Milliseconds)
                long timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                cb(new { type = "audio", data = buffer, timestamp = timestamp }); 
             } catch { }
        }

        private static async Task<byte[]> BlurROI(byte[] imageBytes, int x, int y, int width, int height)
        {
            await Task.Yield();
            try
            {
                using (var ms = new MemoryStream(imageBytes))
                using (var originalImage = new Bitmap(ms))
                {
                    using (var blurredRegion = new Bitmap(width, height))
                    using (var graphics = Graphics.FromImage(blurredRegion))
                    {
                        graphics.DrawImage(originalImage, new Rectangle(0, 0, width, height), new Rectangle(x, y, width, height), GraphicsUnit.Pixel);
                        using (var blurred = ApplyBoxBlur(blurredRegion, 15))
                        using (var finalGraphics = Graphics.FromImage(originalImage))
                        {
                            finalGraphics.DrawImage(blurred, x, y);
                        }
                    }
                    using (var resultStream = new MemoryStream())
                    {
                        originalImage.Save(resultStream, ImageFormat.Png);
                        return resultStream.ToArray();
                    }
                }
            }
            catch { return imageBytes; }
        }

        private static Bitmap ApplyBoxBlur(Bitmap source, int radius)
        {
            int width = source.Width;
            int height = source.Height;
            var result = new Bitmap(width, height);

            for (int y = 0; y < height; y++)
            {
                for (int x = 0; x < width; x++)
                {
                    int r = 0, g = 0, b = 0, count = 0;
                    for (int dy = -radius; dy <= radius; dy++)
                    {
                        for (int dx = -radius; dx <= radius; dx++)
                        {
                            int px = x + dx;
                            int py = y + dy;
                            if (px >= 0 && px < width && py >= 0 && py < height)
                            {
                                var pixel = source.GetPixel(px, py);
                                r += pixel.R; g += pixel.G; b += pixel.B;
                                count++;
                            }
                        }
                    }
                    if (count > 0) result.SetPixel(x, y, Color.FromArgb(r / count, g / count, b / count));
                }
            }
            return result;
        }

        private static object SetApplicationVolume(dynamic input)
        {
            try
            {
                int targetPid = (int)input.pid;
                float volume = (float)input.volume; // 0.0 ~ 1.0
                
                var deviceEnumerator = new MMDeviceEnumerator();
                var device = deviceEnumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
                
                var sessions = device.AudioSessionManager.Sessions;
                bool found = false;
                
                for (int i = 0; i < sessions.Count; i++)
                {
                    var session = sessions[i];
                    uint sessionPid = session.GetProcessID;
                    if ((int)sessionPid == targetPid)
                    {
                        session.SimpleAudioVolume.Volume = volume;
                        found = true;
                        Console.WriteLine($"[OnVoiceComBridge] ✅ 볼륨 조절 성공: PID={targetPid}, Volume={volume:F2}");
                        // 첫 번째 일치하는 세션만 조절 (일반적으로 하나의 프로세스는 하나의 세션을 가짐)
                        break;
                    }
                }
                
                if (!found)
                {
                    Console.WriteLine($"[OnVoiceComBridge] ⚠️ PID {targetPid}에 해당하는 오디오 세션을 찾을 수 없습니다.");
                }
                
                return new { ok = found, pid = targetPid, volume = volume };
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[OnVoiceComBridge] ❌ 볼륨 조절 오류: {ex.Message}");
                return new { ok = false, error = ex.Message };
            }
        }

        private static object ListAudioSessions()
        {
            try
            {
                var deviceEnumerator = new MMDeviceEnumerator();
                var device = deviceEnumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
                var sessions = device.AudioSessionManager.Sessions;
                var list = new List<object>();

                for (int i = 0; i < sessions.Count; i++)
                {
                    var session = sessions[i];
                    uint sessionPid = session.GetProcessID;
                    string appName = string.Empty;
                    string executablePath = string.Empty;
                    string displayName = session.DisplayName ?? string.Empty;

                    if (sessionPid > 0)
                    {
                        try
                        {
                            using var process = Process.GetProcessById((int)sessionPid);
                            appName = $"{process.ProcessName}.exe";
                            try
                            {
                                executablePath = process.MainModule?.FileName ?? string.Empty;
                            }
                            catch { }

                            if (string.IsNullOrWhiteSpace(displayName))
                            {
                                displayName = process.MainWindowTitle;
                            }
                        }
                        catch { }
                    }

                    if (string.IsNullOrWhiteSpace(displayName))
                    {
                        displayName = appName;
                    }

                    if (string.IsNullOrWhiteSpace(displayName))
                    {
                        displayName = session.GetSessionInstanceIdentifier ?? $"PID {sessionPid}";
                    }

                    float volume = 0f;
                    try
                    {
                        volume = session.SimpleAudioVolume?.Volume ?? 0f;
                    }
                    catch { }

                    list.Add(new
                    {
                        id = session.GetSessionIdentifier,
                        pid = (int)sessionPid,
                        name = displayName ?? string.Empty,
                        appName = appName ?? string.Empty,
                        volume,
                        state = (int)session.State,
                        executablePath = executablePath
                    });
                }

                return new { ok = true, sessions = list };
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[OnVoiceComBridge] ❌ 세션 나열 오류: {ex.Message}");
                return new { ok = false, error = ex.Message };
            }
        }
    }

    [ComImport, Guid("43a468da-7889-46c9-99de-38cb93e4e649"), InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IOnVoiceCapture
    {
        [DispId(1)] void StartCapture(int pid);
        [DispId(2)] void StopCapture();
        [DispId(3)] int GetCaptureState();
        [DispId(4)] int FindChromeProcess();
        [DispId(5)] int FindEdgeProcess();
        [DispId(6)] int FindDiscordProcess();
    }

    [ComVisible(true), Guid("52b4a16b-9f83-4a3e-9240-4dd6676540ea"), ClassInterface(ClassInterfaceType.None)]
    public class OnVoiceCaptureEventSink : IOnVoiceCaptureEvents
    {
        [DispId(1)] public void OnAudioData([MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_UI1)] byte[] pcmData) => Startup.OnAudioData(pcmData);
    }

    [ComImport, Guid("B196B284-BAB4-101A-B69C-00AA00341D07"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IConnectionPointContainer { void EnumConnectionPoints(out IEnumConnectionPoints? ppEnum); void FindConnectionPoint(ref Guid riid, out IConnectionPoint? ppCP); }
    
    [ComImport, Guid("B196B285-BAB4-101A-B69C-00AA00341D07"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IEnumConnectionPoints { void Next(uint c, IConnectionPoint[] r, out uint f); void Skip(uint c); void Reset(); void Clone(out IEnumConnectionPoints? p); }
    
    [ComImport, Guid("B196B286-BAB4-101A-B69C-00AA00341D07"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IConnectionPoint 
    { 
        void GetConnectionInterface(out Guid p); 
        void GetConnectionPointContainer(out IConnectionPointContainer? p); 
        void Advise(IntPtr pUnkSink, out uint pdwCookie); 
        void Unadvise(uint c); 
        void EnumConnections(out object? p); 
    }

    [ComVisible(true), Guid("52b4a16b-9f83-4a3e-9240-4dd6676540ea"), InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IOnVoiceCaptureEvents { [DispId(1)] void OnAudioData([MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_UI1)] byte[] pcmData); }
}