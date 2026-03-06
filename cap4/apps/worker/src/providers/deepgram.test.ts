import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribeWithDeepgram } from "./deepgram.js";

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

describe("transcribeWithDeepgram", () => {
  it("parses utterance segments into normalized transcript output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      createResponse({
        ok: true,
        status: 200,
        json: async () => ({
          results: {
            utterances: [
              { start: 0.1234, end: 1.9876, transcript: " Hello world ", confidence: 0.98, speaker: 2 },
              { start: 2, end: 3.5, transcript: "Second sentence", confidence: 0.87, speaker: 1 }
            ],
            channels: [{ alternatives: [{ language: "en-US", transcript: "Hello world Second sentence" }] }]
          }
        })
      })
    ));

    const result = await transcribeWithDeepgram({
      apiKey: "test-key",
      baseUrl: "https://api.deepgram.test",
      model: "nova-3",
      timeoutMs: 1000,
      mediaBuffer: Buffer.from("video"),
      mediaContentType: "video/mp4"
    });

    expect(result.language).toBe("en-US");
    expect(result.transcriptText).toBe("Hello world\nSecond sentence");
    expect(result.segments).toEqual([
      {
        startSeconds: 0.123,
        endSeconds: 1.988,
        text: "Hello world",
        confidence: 0.98,
        speaker: 2
      },
      {
        startSeconds: 2,
        endSeconds: 3.5,
        text: "Second sentence",
        confidence: 0.87,
        speaker: 1
      }
    ]);
  });

  it("builds a fallback segment when utterances are missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      createResponse({
        ok: true,
        status: 200,
        json: async () => ({
          results: {
            channels: [{ alternatives: [{ transcript: "Fallback transcript", languages: ["en"] }] }]
          }
        })
      })
    ));

    const result = await transcribeWithDeepgram({
      apiKey: "test-key",
      baseUrl: "https://api.deepgram.test",
      model: "nova-3",
      timeoutMs: 1000,
      mediaBuffer: Buffer.from("video"),
      mediaContentType: "video/mp4"
    });

    expect(result.language).toBe("en");
    expect(result.transcriptText).toBe("Fallback transcript");
    expect(result.segments).toEqual([
      {
        startSeconds: 0,
        endSeconds: 0,
        text: "Fallback transcript",
        confidence: null,
        speaker: null
      }
    ]);
  });

  it.each([401, 403])("marks %s responses as fatal", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      createResponse({
        ok: false,
        status,
        text: async () => "unauthorized"
      })
    ));

    await expect(
      transcribeWithDeepgram({
        apiKey: "bad-key",
        baseUrl: "https://api.deepgram.test",
        model: "nova-3",
        timeoutMs: 1000,
        mediaBuffer: Buffer.from("video"),
        mediaContentType: "video/mp4"
      })
    ).rejects.toMatchObject({
      fatal: true,
      message: expect.stringContaining(`deepgram request failed (${status})`)
    });
  });
});
