import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  ClaudeCliDocModelClient,
  DocCallBudgetError,
  createClaudeCliRunner,
  parseJsonText,
  type CliRunner,
  type DocModelStore
} from "./model-client.js";

const TestSchema = z.object({ answer: z.string() });

function memoryStore(initialCalls = 0): DocModelStore & { cache: Map<string, unknown>; calls: number } {
  const state = {
    cache: new Map<string, unknown>(),
    calls: initialCalls,
    async getCached(key: string) {
      return state.cache.get(key) ?? null;
    },
    async putCached(key: string, value: unknown) {
      state.cache.set(key, value);
    },
    async countCallsLast24h() {
      return state.calls;
    },
    async recordCall() {
      state.calls += 1;
    }
  };
  return state;
}

function envelope(result: string): string {
  return JSON.stringify({ type: "result", is_error: false, result });
}

function makeClient(runner: CliRunner, store = memoryStore(), overrides: Partial<{ maxCallsPerJob: number; maxCallsPerDay: number; timeoutMs: number }> = {}) {
  return new ClaudeCliDocModelClient({
    runner,
    store,
    timeoutMs: overrides.timeoutMs ?? 5000,
    maxCallsPerJob: overrides.maxCallsPerJob ?? 6,
    maxCallsPerDay: overrides.maxCallsPerDay ?? 60,
    log: () => undefined
  });
}

const baseParams = {
  systemPrompt: "sys",
  userPrompt: "user",
  imagePaths: [],
  schema: TestSchema,
  model: "test-model",
  workdir: "/tmp",
  purpose: "test"
};

describe("ClaudeCliDocModelClient", () => {
  it("parses a valid structured response", async () => {
    const runner = vi.fn().mockResolvedValue({
      code: 0,
      stdout: envelope('{"answer":"ok"}'),
      stderr: "",
      timedOut: false
    });
    const client = makeClient(runner);
    const result = await client.generateStructured(baseParams);
    expect(result).toEqual({ answer: "ok" });
    expect(runner).toHaveBeenCalledTimes(1);
    const args = runner.mock.calls[0][0].args;
    expect(args).toContain("--model");
    expect(args).toContain("test-model");
    expect(args).toContain("--output-format");
  });

  it("returns cached results without spawning the CLI", async () => {
    const runner = vi.fn();
    const store = memoryStore();
    store.cache.set("key1", { answer: "cached" });
    const client = makeClient(runner, store);
    const result = await client.generateStructured({ ...baseParams, cacheKey: "key1" });
    expect(result).toEqual({ answer: "cached" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("caches successful responses by cacheKey", async () => {
    const runner = vi.fn().mockResolvedValue({
      code: 0,
      stdout: envelope('{"answer":"fresh"}'),
      stderr: "",
      timedOut: false
    });
    const store = memoryStore();
    const client = makeClient(runner, store);
    await client.generateStructured({ ...baseParams, cacheKey: "key2" });
    expect(store.cache.get("key2")).toEqual({ answer: "fresh" });
  });

  it("retries once on malformed JSON with a corrective prompt", async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ code: 0, stdout: envelope("not json at all"), stderr: "", timedOut: false })
      .mockResolvedValueOnce({ code: 0, stdout: envelope('{"answer":"second"}'), stderr: "", timedOut: false });
    const store = memoryStore();
    const client = makeClient(runner, store);
    const result = await client.generateStructured(baseParams);
    expect(result).toEqual({ answer: "second" });
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[1][0].stdin).toContain("previous response was rejected");
    expect(store.calls).toBe(2); // both real calls hit the log
  });

  it("retries once on schema-invalid JSON, then fails", async () => {
    const runner = vi.fn().mockResolvedValue({
      code: 0,
      stdout: envelope('{"wrong":"shape"}'),
      stderr: "",
      timedOut: false
    });
    const client = makeClient(runner);
    await expect(client.generateStructured(baseParams)).rejects.toThrow(/invalid after retry/);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("throws on non-zero exit without retrying", async () => {
    const runner = vi.fn().mockResolvedValue({ code: 1, stdout: "", stderr: "boom", timedOut: false });
    const client = makeClient(runner);
    await expect(client.generateStructured(baseParams)).rejects.toThrow(/exited with code 1/);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("enforces the per-job call budget", async () => {
    const runner = vi.fn().mockResolvedValue({
      code: 0,
      stdout: envelope('{"answer":"ok"}'),
      stderr: "",
      timedOut: false
    });
    const client = makeClient(runner, memoryStore(), { maxCallsPerJob: 2 });
    await client.generateStructured(baseParams);
    await client.generateStructured(baseParams);
    await expect(client.generateStructured(baseParams)).rejects.toThrow(DocCallBudgetError);
  });

  it("enforces the per-day call budget", async () => {
    const runner = vi.fn();
    const client = makeClient(runner, memoryStore(60), { maxCallsPerDay: 60 });
    await expect(client.generateStructured(baseParams)).rejects.toThrow(/per-day/);
    expect(runner).not.toHaveBeenCalled();
  });

  it("throws when the model id is not configured", async () => {
    const client = makeClient(vi.fn());
    await expect(client.generateStructured({ ...baseParams, model: "" })).rejects.toThrow(/not configured/);
  });

  it("kills the CLI on timeout", async () => {
    const dir = mkdtempSync(join(tmpdir(), "doc-cli-test-"));
    const fakeBin = join(dir, "fake-claude");
    // exec so SIGKILL hits sleep itself (a grandchild would hold the stdio
    // pipes open past the kill and stall the close event)
    writeFileSync(fakeBin, "#!/bin/sh\nexec sleep 5\n");
    chmodSync(fakeBin, 0o755);
    const client = makeClient(createClaudeCliRunner(fakeBin), memoryStore(), { timeoutMs: 300 });
    await expect(client.generateStructured(baseParams)).rejects.toThrow(/timed out/);
  });
});

describe("parseJsonText", () => {
  it("parses plain JSON", () => {
    expect(parseJsonText('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips code fences and surrounding prose", () => {
    expect(parseJsonText('Here you go:\n```json\n{"a":1}\n```\nDone.')).toEqual({ a: 1 });
  });

  it("throws when no JSON object is present", () => {
    expect(() => parseJsonText("nothing here")).toThrow(/no JSON object/);
  });
});
