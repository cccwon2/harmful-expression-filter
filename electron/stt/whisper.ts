import { execFile } from "child_process";
import path from "path";

export function runWhisper(audioPath: string): Promise<string> {
  return new Promise((resolve, reject) => {

    const exe = path.join(
      __dirname,
      "whisper.cpp",
      "build",
      "bin",
      "Release",
      "whisper-cli.exe"
    );

    const model = path.join(
      __dirname,
      "models",
      "ggml-small.bin"
    );

    console.log("[STT] Running whisper-cli:", exe);
    console.log("[STT] Model:", model);
    console.log("[STT] Audio Input:", audioPath);

    execFile(
      exe,
      ["-m", model, "-f", audioPath],
      (err, stdout, stderr) => {
        if (err) {
          console.error("[STT] Error executing whisper-cli:", err);
          console.error("[STT] stderr:", stderr);
          return reject(err);
        }

        if (stderr) {
          console.warn("[STT] whisper-cli stderr:", stderr);
        }

        const text = stdout.trim();
        console.log("[STT] FINISHED:", text);

        resolve(text);
      }
    );
  });
}
