import { spawn } from "node:child_process";

export type ExecResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

/**
 * Runs a child process to completion, capturing stdout/stderr. Used for both
 * ffmpeg/ffprobe invocations and the headless `claude -p` calls; the latter
 * pass stdin (the prompt) and a hard timeout (SIGKILL on expiry).
 */
export async function runProcess(opts: {
  bin: string;
  args: string[];
  cwd?: string;
  stdin?: string;
  timeoutMs?: number;
}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.bin, opts.args, { cwd: opts.cwd });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timer: NodeJS.Timeout | null = null;

    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, opts.timeoutMs);
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`${opts.bin} spawn error: ${err.message}`));
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });

    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin);
    }
    child.stdin.end();
  });
}
