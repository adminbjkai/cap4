import type { z } from "zod";
import { relative, isAbsolute } from "node:path";
import { runProcess, type ExecResult } from "./exec.js";

export type GenerateStructuredParams<T> = {
  systemPrompt: string;
  userPrompt: string;
  imagePaths: string[];
  // Output-typed: schemas with .default() fields have a wider input type,
  // and T must infer as the parsed output.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: z.ZodType<T, any, any>;
  /** Resolved model id (DOC_MODEL_STRONG / DOC_MODEL_TRIAGE). Never hardcoded. */
  model: string;
  /** Temp job folder containing the frame images; cwd of the CLI process. */
  workdir: string;
  /** When set, the call is cached — identical keys never re-spend credits. */
  cacheKey?: string;
  videoId?: string;
  purpose: string;
};

export interface DocModelClient {
  generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T>;
}

/** Durable cache + call log, backed by doc_model_cache / doc_model_calls. */
export type DocModelStore = {
  getCached(cacheKey: string): Promise<unknown | null>;
  putCached(cacheKey: string, value: unknown, model: string): Promise<void>;
  countCallsLast24h(): Promise<number>;
  recordCall(videoId: string | null, purpose: string, model: string): Promise<void>;
};

export type CliRunner = (opts: {
  args: string[];
  stdin: string;
  cwd: string;
  timeoutMs: number;
}) => Promise<ExecResult>;

export function createClaudeCliRunner(bin = "claude"): CliRunner {
  return ({ args, stdin, cwd, timeoutMs }) => runProcess({ bin, args, cwd, stdin, timeoutMs });
}

export class DocCallBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocCallBudgetError";
  }
}

/** Extracts the JSON object from model text that may carry code fences or prose. */
export function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error("no JSON object found in model output");
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

type ClientOptions = {
  runner: CliRunner;
  store: DocModelStore;
  timeoutMs: number;
  maxCallsPerJob: number;
  maxCallsPerDay: number;
  log: (event: string, fields: Record<string, unknown>) => void;
};

/**
 * claude-cli backend: spawns headless Claude Code (`claude -p`) with the job
 * workdir as cwd so the model can Read the frame images from disk. Uses the
 * developer's OAuth subscription — no API key anywhere.
 */
export class ClaudeCliDocModelClient implements DocModelClient {
  private jobCallCount = 0;

  constructor(private readonly opts: ClientOptions) {}

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    if (!params.model) {
      throw new Error("doc model id not configured (set DOC_MODEL_STRONG / DOC_MODEL_TRIAGE)");
    }

    if (params.cacheKey) {
      const cached = await this.opts.store.getCached(params.cacheKey);
      if (cached !== null) {
        const parsed = params.schema.safeParse(cached);
        if (parsed.success) {
          this.opts.log("doc.model.cache_hit", { cache_key: params.cacheKey, purpose: params.purpose });
          return parsed.data;
        }
        // A cached value that no longer matches the schema (prompt/schema
        // drift) is treated as a miss; the prompt version in the key should
        // normally prevent this.
      }
    }

    const imageList = params.imagePaths
      .map((p) => (isAbsolute(p) ? relative(params.workdir, p) : p))
      .join("\n");
    const basePrompt = imageList.length > 0
      ? `${params.userPrompt}\n\nImages available in the working directory (read them from disk by path):\n${imageList}`
      : params.userPrompt;

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      await this.checkBudget(params.purpose);
      this.jobCallCount += 1;
      await this.opts.store.recordCall(params.videoId ?? null, params.purpose, params.model);

      const prompt = attempt === 1 || !lastError
        ? basePrompt
        : `${basePrompt}\n\nYour previous response was rejected: ${lastError.message}\nReturn ONLY a single valid JSON object matching the requested schema — no prose, no code fences.`;

      const result = await this.opts.runner({
        args: [
          "-p",
          "--output-format", "json",
          "--model", params.model,
          "--append-system-prompt", params.systemPrompt,
          "--allowedTools", "Read"
        ],
        stdin: prompt,
        cwd: params.workdir,
        timeoutMs: this.opts.timeoutMs
      });

      if (result.stderr.trim()) {
        this.opts.log("doc.model.stderr", { purpose: params.purpose, stderr: result.stderr.slice(0, 2000) });
      }
      if (result.timedOut) {
        throw new Error(`claude -p timed out after ${this.opts.timeoutMs}ms (purpose=${params.purpose})`);
      }
      if (result.code !== 0) {
        throw new Error(`claude -p exited with code ${result.code}: ${result.stderr.slice(0, 500)}`);
      }

      try {
        const envelope = JSON.parse(result.stdout) as { is_error?: boolean; result?: string };
        if (envelope.is_error || typeof envelope.result !== "string") {
          throw new Error(`claude -p reported an error: ${String(envelope.result).slice(0, 500)}`);
        }
        const value = parseJsonText(envelope.result);
        const parsed = params.schema.safeParse(value);
        if (!parsed.success) {
          throw new Error(`schema validation failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 500)}`);
        }
        if (params.cacheKey) {
          await this.opts.store.putCached(params.cacheKey, value, params.model);
        }
        return parsed.data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.opts.log("doc.model.malformed_output", {
          purpose: params.purpose,
          attempt,
          error: lastError.message
        });
      }
    }

    throw new Error(`model output invalid after retry (purpose=${params.purpose}): ${lastError?.message}`);
  }

  private async checkBudget(purpose: string): Promise<void> {
    if (this.jobCallCount >= this.opts.maxCallsPerJob) {
      throw new DocCallBudgetError(`per-job model call budget exhausted (${this.opts.maxCallsPerJob}) at purpose=${purpose}`);
    }
    const today = await this.opts.store.countCallsLast24h();
    if (today >= this.opts.maxCallsPerDay) {
      throw new DocCallBudgetError(`per-day model call budget exhausted (${this.opts.maxCallsPerDay}) at purpose=${purpose}`);
    }
  }
}

/** Stub for a future paid-key backend; selected via DOC_MODEL_BACKEND. */
export class AnthropicApiDocModelClient implements DocModelClient {
  async generateStructured<T>(): Promise<T> {
    throw new Error("anthropic-api backend not configured");
  }
}

export function createDocModelClient(
  backend: "claude-cli" | "anthropic-api",
  opts: ClientOptions
): DocModelClient {
  if (backend === "anthropic-api") return new AnthropicApiDocModelClient();
  return new ClaudeCliDocModelClient(opts);
}
