using System;
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
        /// Subscribe to COM events (OnAudioData).
        /// This is skeleton code; actual event name and delegate type should be adjusted.
        /// 
        /// TODO: 실제 OnVoice COM 인터페이스에 맞게 이 부분을 구현해야 합니다:
        /// 1. COM interop 어셈블리를 추가한 경우:
        ///    ((OnVoiceAudioBridgeLib.OnVoiceCapture)_capture).OnAudioData += OnAudioData;
        /// 
        /// 2. dynamic event를 사용하는 경우, C#에서 직접 이벤트를 구독할 수 있는지 확인 필요.
        /// 
        /// 현재는 skeleton이므로 구체 구현은 프로젝트에서 채워 넣는다.
        /// </summary>
        private static void SubscribeComEvents()
        {
            if (_capture == null) return;

            // TODO:
            // 1. COM interop 어셈블리를 추가한 경우:
            //    ((OnVoiceAudioBridgeLib.OnVoiceCapture)_capture).OnAudioData += OnAudioData;
            //
            // 2. dynamic event를 사용하는 경우, C#에서 직접 이벤트를 구독할 수 있는지 확인 필요.
            //
            // 현재는 skeleton이므로 구체 구현은 프로젝트에서 채워 넣는다.
        }

        /// <summary>
        /// Called by COM when audio data is available.
        /// This method forwards PCM bytes to Node via the stored JS callback.
        /// 
        /// ⚠️ 실제 COM 이벤트 시그니처(예: void OnAudioData(byte[] data, int size) 등)에 맞춰
        /// 이 메서드의 시그니처를 수정해야 합니다.
        /// </summary>
        /// <param name="buffer">PCM audio data from COM (e.g., 16kHz mono)</param>
        private static void OnAudioData(byte[] buffer)
        {
            var cb = _audioCallback;
            if (cb == null) return;

            // Fire-and-forget: edge-js callback returns a Task<object>
            // JS side is responsible for handling the message and acknowledging via cb(null, res).
            _ = cb(new
            {
                type = "audio",
                data = buffer
            });
        }
    }
}

