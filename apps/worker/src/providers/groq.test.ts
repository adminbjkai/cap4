import { afterEach, describe, expect, it, vi } from "vitest";
import { summarizeWithGroq } from "./groq.js";

type MockResponse = {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};

function createResponse(response: MockResponse): Response {
  return {
    ok: response.ok,
    status: response.status,
    json: response.json ?? (async () => ({})),
    text: response.text ?? (async () => "")
  } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("summarizeWithGroq", () => {
  it("extracts JSON from fenced markdown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      createResponse({
        ok: true,
        status: 200,
        json: async () => ({
          model: "llama-3.3",
          choices: [
            {
              message: {
                content: [
                  "```json",
                  '{"title":"Release recap","summary":"A concise summary.","key_points":["One","Two"]}',
                  "```"
                ].join("\n")
              }
            }
          ]
        })
      })
    ));

    const result = await summarizeWithGroq({
      apiKey: "test-key",
      baseUrl: "https://api.groq.test/openai/v1",
      model: "llama-3.3",
      timeoutMs: 1000,
      transcript: "Transcript body"
    });

    expect(result).toEqual({
      model: "llama-3.3",
      title: "Release recap",
      summary: "A concise summary.",
      keyPoints: ["One", "Two"],
      chapters: [],
      entities: undefined,
      actionItems: undefined,
      quotes: undefined
    });
  });

  it("normalizes mixed key point structures from markdown-wrapped output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      createResponse({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: `Summary follows:\n{"title":"Ops Review","summary":"All systems green.","key_points":["  Keep logs  ",{"point":"Trim retries"}, "", {"point":"  Surface health "}]}`
              }
            }
          ]
        })
      })
    ));

    const result = await summarizeWithGroq({
      apiKey: "test-key",
      baseUrl: "https://api.groq.test/openai/v1",
      model: "llama-3.3",
      timeoutMs: 1000,
      transcript: "Transcript body"
    });

    expect(result.model).toBe("llama-3.3");
    expect(result.title).toBe("Ops Review");
    expect(result.summary).toBe("All systems green.");
    expect(result.keyPoints).toEqual(["Keep logs", "Trim retries", "Surface health"]);
  });

  it.each([401, 403])("marks %s responses as fatal", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      createResponse({
        ok: false,
        status,
        text: async () => "forbidden"
      })
    ));

    await expect(
      summarizeWithGroq({
        apiKey: "bad-key",
        baseUrl: "https://api.groq.test/openai/v1",
        model: "llama-3.3",
        timeoutMs: 1000,
        transcript: "Transcript body"
      })
    ).rejects.toMatchObject({
      fatal: true,
      message: expect.stringContaining(`groq request failed (${status})`)
    });
  });
});
