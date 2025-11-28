using System;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace OnVoiceComBridge
{
    class Program
    {
        static async Task Main(string[] args)
        {
            // Stdio 통신을 위해 UTF-8 인코딩 설정
            Console.InputEncoding = Encoding.UTF8;
            Console.OutputEncoding = Encoding.UTF8;

            var startup = new Startup();
            
            // 오디오 데이터 이벤트 구독
            Startup.OnAudioDataReceived += (data) => SendMessage(data);

            // 초기화 메시지 전송
            SendMessage(new { type = "status", message = "OnVoiceComBridge Started" });

            while (true)
            {
                try
                {
                    string? line = await Console.In.ReadLineAsync();
                    if (line == null) break; // EOF (부모 프로세스 종료)

                    if (string.IsNullOrWhiteSpace(line)) continue;

                    try
                    {
                        // JSON 파싱
                        var command = JsonSerializer.Deserialize<JsonElement>(line);
                        
                        // Startup.Invoke 호출 (기존 로직 재사용)
                        // dynamic으로 변환하여 기존 Invoke 메서드와 호환성 유지
                        dynamic input = Newtonsoft.Json.JsonConvert.DeserializeObject<dynamic>(line)!;
                        
                        // 비동기 실행
                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                var result = await startup.Invoke(input);
                                SendMessage(new { type = "response", id = GetId(command), result });
                            }
                            catch (Exception ex)
                            {
                                SendMessage(new { type = "error", id = GetId(command), error = ex.Message });
                            }
                        });
                    }
                    catch (Exception ex)
                    {
                        SendMessage(new { type = "error", error = $"JSON Parse Error: {ex.Message}" });
                    }
                }
                catch (Exception ex)
                {
                    // Stdio 읽기 오류 (치명적)
                    Console.Error.WriteLine($"Stdio Error: {ex.Message}");
                    break;
                }
            }
        }

        static string? GetId(JsonElement command)
        {
            if (command.TryGetProperty("id", out var idElement))
            {
                return idElement.ToString();
            }
            return null;
        }

        static void SendMessage(object data)
        {
            string json = JsonSerializer.Serialize(data);
            Console.WriteLine(json);
        }
    }
}
