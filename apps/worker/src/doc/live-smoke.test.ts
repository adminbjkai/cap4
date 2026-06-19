/**
 * Opt-in live smoke test — one real `claude -p` structured call end to end.
 * Skipped unless DOC_LIVE_SMOKE=1 (never runs in CI; spends one real model
 * call from the subscription pool).
 *
 *   DOC_LIVE_SMOKE=1 DOC_MODEL_TRIAGE=<model-id> pnpm --filter @cap/worker test
 */
import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { z } from "zod";
import { ClaudeCliDocModelClient, createClaudeCliRunner, type DocModelStore } from "./model-client.js";

const LIVE = process.env.DOC_LIVE_SMOKE === "1";

const noopStore: DocModelStore = {
  getCached: async () => null,
  putCached: async () => undefined,
  countCallsLast24h: async () => 0,
  recordCall: async () => undefined
};

describe.skipIf(!LIVE)("live claude -p smoke", () => {
  it("performs one real structured call", async () => {
    const model = process.env.DOC_MODEL_TRIAGE || process.env.DOC_MODEL_STRONG;
    if (!model) {
      throw new Error("set DOC_MODEL_TRIAGE or DOC_MODEL_STRONG for the live smoke test");
    }

    const client = new ClaudeCliDocModelClient({
      runner: createClaudeCliRunner(),
      store: noopStore,
      timeoutMs: 120_000,
      maxCallsPerJob: 2,
      maxCallsPerDay: 1000,
      log: (event, fields) => console.log(event, fields)
    });

    const result = await client.generateStructured({
      systemPrompt: "You respond with strict JSON only.",
      userPrompt: 'Return exactly this JSON object: {"answer":"pong"}',
      imagePaths: [],
      schema: z.object({ answer: z.string() }),
      model,
      workdir: tmpdir(),
      purpose: "live-smoke"
    });

    expect(result.answer.toLowerCase()).toContain("pong");
  }, 180_000);
});
