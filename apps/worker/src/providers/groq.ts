type GroqChatCompletionResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export type GroqSummary = {
  model: string;
  title: string;
  summary: string;
  keyPoints: string[];
};

function stripCodeFences(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const firstLineBreak = trimmed.indexOf("\n");
  const withoutPrefix = firstLineBreak >= 0 ? trimmed.slice(firstLineBreak + 1) : trimmed;
  return withoutPrefix.replace(/```$/u, "").trim();
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const direct = stripCodeFences(raw);
  try {
    return JSON.parse(direct) as Record<string, unknown>;
  } catch {
    const firstBrace = direct.indexOf("{");
    const lastBrace = direct.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) {
      throw new Error("groq output was not valid JSON");
    }
    return JSON.parse(direct.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
  }
}

function toNonEmptyString(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeKeyPoints(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object" && "point" in item && typeof item.point === "string") {
        return item.point.trim();
      }
      return "";
    })
    .filter((entry) => entry.length > 0);
}

export async function summarizeWithGroq(args: {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  transcript: string;
}): Promise<GroqSummary> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
  const url = new URL(args.baseUrl);
  const normalizedPath = url.pathname.endsWith("/")
    ? `${url.pathname}chat/completions`
    : `${url.pathname}/chat/completions`;
  url.pathname = normalizedPath.replace(/\/{2,}/g, "/");
  const promptTranscript = args.transcript.length > 32000 ? args.transcript.slice(0, 32000) : args.transcript;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: args.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You summarize video transcripts. Return strict JSON with keys: title (string), summary (string), key_points (array of short strings)."
          },
          {
            role: "user",
            content: `Transcript:\n${promptTranscript}`
          }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      throw new Error(`groq request failed (${response.status}): ${detail}`);
    }

    const payload = (await response.json()) as GroqChatCompletionResponse;
    const message = payload.choices?.[0]?.message?.content;
    if (!message) {
      throw new Error("groq response did not include message content");
    }

    const parsed = parseJsonObject(message);
    const title = toNonEmptyString(parsed.title, "Untitled summary");
    const summary = toNonEmptyString(parsed.summary, "No summary available.");
    const keyPoints = normalizeKeyPoints(parsed.key_points ?? parsed.keyPoints);

    return {
      model: String(payload.model ?? args.model),
      title,
      summary,
      keyPoints
    };
  } finally {
    clearTimeout(timeout);
  }
}
