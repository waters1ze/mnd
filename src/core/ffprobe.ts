import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { registerProcess, unregisterProcess, isCancellationRequested } from "./cancellation.js";

const execFileAsync = promisify(execFile);

// @ts-ignore
import ffprobeStatic from "ffprobe-static";

export async function getMediaDuration(filePath: string): Promise<number | null> {
  if (isCancellationRequested()) return null;

  try {
    const ffprobePromise = execFileAsync(ffprobeStatic.path, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath
    ]);

    const child = ffprobePromise.child;
    if (child && child.pid) {
      registerProcess({
        pid: child.pid,
        kind: "ffprobe",
        process: child,
        ownedByRun: true
      });
    }

    const { stdout } = await ffprobePromise;

    if (child && child.pid) {
      unregisterProcess(child.pid);
    }

    const dur = parseFloat(stdout.trim());
    return isNaN(dur) ? null : dur;
  } catch (e) {
    // ffprobe failed
    return null;
  }
}
