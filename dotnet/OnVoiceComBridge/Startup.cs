using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Threading;
using System.Threading.Tasks;
using System.Reflection;
using System.Text;
using System.Net.Http;
using System.Text.Json;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;
using Microsoft.Windows.AI;
using Microsoft.Windows.AI.Imaging; 

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
        
        // OCR 관련 필드
        private static TextRecognizer? _textRecognizer;
        private static readonly HttpClient _httpClient = new HttpClient();
        private static string _serverUrl = LoadServerUrlFromEnv();

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

                case "ocr":
                    try
                    {
                        var ocrStartTime = DateTime.UtcNow;
                        byte[] imageBytes = (byte[])input.imageData;
                        Console.WriteLine($"[OnVoiceComBridge] OCR 요청: 이미지 크기 {imageBytes.Length} bytes");
                        
                        // SoftwareBitmap으로 변환
                        SoftwareBitmap? softwareBitmap = await ConvertBytesToSoftwareBitmap(imageBytes);
                        if (softwareBitmap == null)
                        {
                            return new { ok = false, error = "이미지 변환 실패" };
                        }
                        
                        // OCR 수행
                        var ocrEndTime = DateTime.UtcNow;
                        string recognizedText = await RecognizeTextFromSoftwareBitmap(softwareBitmap);
                        var ocrTime = (ocrEndTime - ocrStartTime).TotalSeconds;
                        Console.WriteLine($"[OnVoiceComBridge] OCR 완료: {recognizedText.Length}자 추출 ({ocrTime:F3}초)");
                        
                        // 텍스트를 줄 단위로 분리 (서버 형식과 일치)
                        var texts = new List<string>();
                        if (!string.IsNullOrWhiteSpace(recognizedText))
                        {
                            var lines = recognizedText.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                            foreach (var line in lines)
                            {
                                var trimmed = line.Trim();
                                if (!string.IsNullOrWhiteSpace(trimmed))
                                {
                                    texts.Add(trimmed);
                                }
                            }
                        }
                        
                        // 서버에 유해성 검사 요청
                        var analysisStartTime = DateTime.UtcNow;
                        var analysisResult = await AnalyzeTextForHarmfulContent(recognizedText);
                        var analysisTime = (DateTime.UtcNow - analysisStartTime).TotalSeconds;
                        var totalTime = (DateTime.UtcNow - ocrStartTime).TotalSeconds;
                        
                        // 서버 응답 형식과 일치하도록 반환
                        return new { 
                            ok = true, 
                            texts = texts.ToArray(),
                            text = recognizedText, // 하위 호환성을 위해 유지
                            is_harmful = analysisResult.isHarmful,
                            isHarmful = analysisResult.isHarmful, // 하위 호환성
                            harmful_words = analysisResult.matchedKeywords,
                            matchedKeywords = analysisResult.matchedKeywords, // 하위 호환성
                            confidence = analysisResult.confidence,
                            processing_time = new {
                                ocr = ocrTime,
                                analysis = analysisTime,
                                total = totalTime
                            }
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
                        var ocrStartTime = DateTime.UtcNow;
                        byte[] imageBytes = (byte[])input.imageData;
                        var roi = input.roi; // { x, y, width, height }
                        int roiX = Convert.ToInt32(roi.x);
                        int roiY = Convert.ToInt32(roi.y);
                        int roiWidth = Convert.ToInt32(roi.width);
                        int roiHeight = Convert.ToInt32(roi.height);
                        
                        Console.WriteLine($"[OnVoiceComBridge] OCR + 블러 요청: ROI({roiX}, {roiY}, {roiWidth}x{roiHeight})");
                        
                        // SoftwareBitmap으로 변환
                        SoftwareBitmap? softwareBitmap = await ConvertBytesToSoftwareBitmap(imageBytes);
                        if (softwareBitmap == null)
                        {
                            return new { ok = false, error = "이미지 변환 실패" };
                        }
                        
                        // OCR 수행
                        var ocrEndTime = DateTime.UtcNow;
                        string recognizedText = await RecognizeTextFromSoftwareBitmap(softwareBitmap);
                        var ocrTime = (ocrEndTime - ocrStartTime).TotalSeconds;
                        Console.WriteLine($"[OnVoiceComBridge] OCR 완료: {recognizedText}");
                        
                        // 텍스트를 줄 단위로 분리 (서버 형식과 일치)
                        var texts = new List<string>();
                        if (!string.IsNullOrWhiteSpace(recognizedText))
                        {
                            var lines = recognizedText.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                            foreach (var line in lines)
                            {
                                var trimmed = line.Trim();
                                if (!string.IsNullOrWhiteSpace(trimmed))
                                {
                                    texts.Add(trimmed);
                                }
                            }
                        }
                        
                        // 서버에 유해성 검사 요청
                        var analysisStartTime = DateTime.UtcNow;
                        var analysisResult = await AnalyzeTextForHarmfulContent(recognizedText);
                        var analysisTime = (DateTime.UtcNow - analysisStartTime).TotalSeconds;
                        var totalTime = (DateTime.UtcNow - ocrStartTime).TotalSeconds;
                        
                        byte[]? blurredImage = null;
                        if (analysisResult.isHarmful)
                        {
                            Console.WriteLine($"[OnVoiceComBridge] 🚨 유해 표현 감지: {string.Join(", ", analysisResult.matchedKeywords)}");
                            // ROI 영역 블러 처리
                            blurredImage = await BlurROI(imageBytes, roiX, roiY, roiWidth, roiHeight);
                        }
                        
                        // 서버 응답 형식과 일치하도록 반환
                        return new { 
                            ok = true, 
                            texts = texts.ToArray(),
                            text = recognizedText, // 하위 호환성
                            is_harmful = analysisResult.isHarmful,
                            isHarmful = analysisResult.isHarmful, // 하위 호환성
                            harmful_words = analysisResult.matchedKeywords,
                            matchedKeywords = analysisResult.matchedKeywords, // 하위 호환성
                            confidence = analysisResult.confidence,
                            processing_time = new {
                                ocr = ocrTime,
                                analysis = analysisTime,
                                total = totalTime
                            },
                            blurredImage = blurredImage
                        };
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine($"[OnVoiceComBridge] ❌ OCR + 블러 오류: {ex.Message}");
                        return new { ok = false, error = ex.Message };
                    }

                case "setServerUrl":
                    _serverUrl = (string)input.url ?? "http://127.0.0.1:8000";
                    Console.WriteLine($"[OnVoiceComBridge] 서버 URL 설정: {_serverUrl}");
                    return new { ok = true, url = _serverUrl };

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

        // ========== .env 파일 읽기 ==========
        
        /// <summary>
        /// 루트 디렉토리의 .env 파일에서 SERVER_URL을 읽어옵니다.
        /// </summary>
        private static string LoadServerUrlFromEnv()
        {
            try
            {
                // 루트 디렉토리 찾기 (Assembly 위치 기준으로 상위 디렉토리 탐색)
                string? rootDir = FindRootDirectory();
                if (rootDir == null)
                {
                    Console.WriteLine("[OnVoiceComBridge] 루트 디렉토리를 찾을 수 없습니다. 기본 SERVER_URL 사용: http://127.0.0.1:8000");
                    return "http://127.0.0.1:8000";
                }

                string envPath = Path.Combine(rootDir, ".env");
                if (!File.Exists(envPath))
                {
                    Console.WriteLine($"[OnVoiceComBridge] .env 파일을 찾을 수 없습니다: {envPath}");
                    Console.WriteLine("[OnVoiceComBridge] 기본 SERVER_URL 사용: http://127.0.0.1:8000");
                    return "http://127.0.0.1:8000";
                }

                // .env 파일 읽기 및 파싱
                var envVars = ParseEnvFile(envPath);
                if (envVars.TryGetValue("SERVER_URL", out string? serverUrl) && !string.IsNullOrWhiteSpace(serverUrl))
                {
                    Console.WriteLine($"[OnVoiceComBridge] .env에서 SERVER_URL 로드: {serverUrl}");
                    return serverUrl.Trim();
                }

                Console.WriteLine("[OnVoiceComBridge] .env 파일에 SERVER_URL이 없습니다. 기본값 사용: http://127.0.0.1:8000");
                return "http://127.0.0.1:8000";
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[OnVoiceComBridge] .env 파일 읽기 오류: {ex.Message}");
                Console.WriteLine("[OnVoiceComBridge] 기본 SERVER_URL 사용: http://127.0.0.1:8000");
                return "http://127.0.0.1:8000";
            }
        }

        /// <summary>
        /// 프로젝트 루트 디렉토리를 찾습니다.
        /// </summary>
        private static string? FindRootDirectory()
        {
            try
            {
                // Assembly 위치에서 시작하여 상위 디렉토리로 탐색
                string? currentDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                if (currentDir == null) return null;

                // 최대 5단계 상위 디렉토리까지 탐색
                for (int i = 0; i < 5; i++)
                {
                    if (currentDir == null) break;
                    
                    // .env 파일이 있거나 package.json이 있는 디렉토리를 루트로 간주
                    string envPath = Path.Combine(currentDir, ".env");
                    string packageJsonPath = Path.Combine(currentDir, "package.json");
                    
                    if (File.Exists(envPath) || File.Exists(packageJsonPath))
                    {
                        return currentDir;
                    }
                    
                    // 상위 디렉토리로 이동
                    var parent = Directory.GetParent(currentDir);
                    if (parent == null) break;
                    currentDir = parent.FullName;
                }

                return null;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[OnVoiceComBridge] 루트 디렉토리 찾기 오류: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// .env 파일을 파싱하여 키-값 쌍을 반환합니다.
        /// </summary>
        private static Dictionary<string, string> ParseEnvFile(string filePath)
        {
            var envVars = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            
            if (!File.Exists(filePath))
            {
                return envVars;
            }

            try
            {
                var lines = File.ReadAllLines(filePath);
                foreach (var line in lines)
                {
                    // 주석 제거
                    var trimmedLine = line.Trim();
                    if (string.IsNullOrWhiteSpace(trimmedLine) || trimmedLine.StartsWith("#"))
                    {
                        continue;
                    }

                    // KEY=VALUE 형식 파싱
                    var equalIndex = trimmedLine.IndexOf('=');
                    if (equalIndex <= 0) continue;

                    var key = trimmedLine.Substring(0, equalIndex).Trim();
                    var value = trimmedLine.Substring(equalIndex + 1).Trim();

                    // 따옴표 제거 (선택적)
                    if (value.Length >= 2)
                    {
                        if ((value.StartsWith("\"") && value.EndsWith("\"")) ||
                            (value.StartsWith("'") && value.EndsWith("'")))
                        {
                            value = value.Substring(1, value.Length - 2);
                        }
                    }

                    if (!string.IsNullOrWhiteSpace(key))
                    {
                        envVars[key] = value;
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[OnVoiceComBridge] .env 파일 파싱 오류: {ex.Message}");
            }

            return envVars;
        }

        // ========== OCR 관련 메서드 ==========
        
        /// <summary>
        /// TextRecognizer 모델이 준비되었는지 확인하고 준비
        /// </summary>
        public static async Task<TextRecognizer> EnsureModelIsReady()
        {
            if (TextRecognizer.GetReadyState() == AIFeatureReadyState.NotReady)
            {
                var loadResult = await TextRecognizer.EnsureReadyAsync();
                if (loadResult.Status != AIFeatureReadyResultState.Success)
                {
                    throw new Exception(loadResult.ExtendedError().Message);
                }
            }

            if (_textRecognizer == null)
            {
                _textRecognizer = await TextRecognizer.CreateAsync();
            }

            return _textRecognizer;
        }

        /// <summary>
        /// SoftwareBitmap에서 텍스트 인식
        /// </summary>
        public static async Task<string> RecognizeTextFromSoftwareBitmap(SoftwareBitmap bitmap)
        {
            TextRecognizer textRecognizer = await EnsureModelIsReady();
            ImageBuffer imageBuffer = ImageBuffer.CreateBufferAttachedToBitmap(bitmap);
            RecognizedText recognizedText = textRecognizer.RecognizeTextFromImage(imageBuffer);
            StringBuilder stringBuilder = new StringBuilder();

            foreach (var line in recognizedText.Lines)
            {
                stringBuilder.AppendLine(line.Text);
            }

            return stringBuilder.ToString().Trim();
        }

        /// <summary>
        /// 바이트 배열을 SoftwareBitmap으로 변환
        /// </summary>
        private static async Task<SoftwareBitmap?> ConvertBytesToSoftwareBitmap(byte[] imageBytes)
        {
            try
            {
                using (var stream = new InMemoryRandomAccessStream())
                {
                    await stream.WriteAsync(imageBytes.AsBuffer());
                    stream.Seek(0);

                    var decoder = await BitmapDecoder.CreateAsync(stream);
                    var bitmap = await decoder.GetSoftwareBitmapAsync();
                    return bitmap;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[OnVoiceComBridge] 이미지 변환 오류: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// 서버에 텍스트를 전송하여 유해성 검사
        /// </summary>
        private static async Task<(bool isHarmful, string[] matchedKeywords, double confidence)> AnalyzeTextForHarmfulContent(string text)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(text))
                {
                    return (false, Array.Empty<string>(), 0.0);
                }

                var requestBody = new
                {
                    text = text.Trim(),
                    use_ai = false
                };

                var json = JsonSerializer.Serialize(requestBody);
                var content = new StringContent(json, Encoding.UTF8, "application/json");

                var response = await _httpClient.PostAsync($"{_serverUrl}/analyze", content);
                response.EnsureSuccessStatusCode();

                var responseJson = await response.Content.ReadAsStringAsync();
                var result = JsonSerializer.Deserialize<JsonElement>(responseJson);

                bool isHarmful = result.GetProperty("has_violation").GetBoolean();
                double confidence = result.TryGetProperty("confidence", out var conf) ? conf.GetDouble() : (isHarmful ? 1.0 : 0.0);
                
                var matchedKeywords = new List<string>();
                if (result.TryGetProperty("matched_keywords", out var keywords))
                {
                    foreach (var keyword in keywords.EnumerateArray())
                    {
                        matchedKeywords.Add(keyword.GetString() ?? "");
                    }
                }

                return (isHarmful, matchedKeywords.ToArray(), confidence);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[OnVoiceComBridge] 유해성 검사 오류: {ex.Message}");
                // 오류 시 안전하게 false 반환
                return (false, Array.Empty<string>(), 0.0);
            }
        }

        /// <summary>
        /// ROI 영역을 블러 처리
        /// </summary>
        private static async Task<byte[]> BlurROI(byte[] imageBytes, int x, int y, int width, int height)
        {
            try
            {
                using (var ms = new MemoryStream(imageBytes))
                using (var originalImage = new Bitmap(ms))
                {
                    // ROI 영역만 블러 처리
                    using (var blurredRegion = new Bitmap(width, height))
                    using (var graphics = Graphics.FromImage(blurredRegion))
                    {
                        // 원본 이미지에서 ROI 영역 추출
                        graphics.DrawImage(originalImage, 
                            new Rectangle(0, 0, width, height),
                            new Rectangle(x, y, width, height),
                            GraphicsUnit.Pixel);

                        // 간단한 블러 효과 (가우시안 블러 대신 박스 블러 사용)
                        // System.Drawing에는 가우시안 블러가 없으므로 간단한 평균 필터 사용
                        var blurred = ApplyBoxBlur(blurredRegion, 15); // 블러 강도

                        // 블러 처리된 영역을 원본 이미지에 다시 그리기
                        using (var finalGraphics = Graphics.FromImage(originalImage))
                        {
                            finalGraphics.DrawImage(blurred, x, y);
                        }
                    }

                    // 결과를 바이트 배열로 변환
                    using (var resultStream = new MemoryStream())
                    {
                        originalImage.Save(resultStream, ImageFormat.Png);
                        return resultStream.ToArray();
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[OnVoiceComBridge] 블러 처리 오류: {ex.Message}");
                // 오류 시 원본 이미지 반환
                return imageBytes;
            }
        }

        /// <summary>
        /// 박스 블러 필터 적용 (간단한 블러 효과)
        /// </summary>
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

                    // 주변 픽셀들의 평균 계산
                    for (int dy = -radius; dy <= radius; dy++)
                    {
                        for (int dx = -radius; dx <= radius; dx++)
                        {
                            int px = x + dx;
                            int py = y + dy;

                            if (px >= 0 && px < width && py >= 0 && py < height)
                            {
                                var pixel = source.GetPixel(px, py);
                                r += pixel.R;
                                g += pixel.G;
                                b += pixel.B;
                                count++;
                            }
                        }
                    }

                    if (count > 0)
                    {
                        r /= count;
                        g /= count;
                        b /= count;
                        result.SetPixel(x, y, Color.FromArgb(r, g, b));
                    }
                }
            }

            return result;
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