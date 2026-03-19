export type TranscriptSegment = {
  startSeconds: number;
  endSeconds: number;
  text: string;
  confidence: number | null;
  speaker: number | null;
};

type DeepgramUtterance = {
  start?: number;
  end?: number;
  transcript?: string;
  confidence?: number;
  speaker?: number;
};

type DeepgramResponse = {
  results?: {
    utterances?: DeepgramUtterance[];
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        language?: string;
        languages?: string[];
      }>;
    }>;
  };
};

export type DeepgramTranscription = {
  language: string;
  transcriptText: string;
  segments: TranscriptSegment[];
};

type FatalError = Error & { fatal?: boolean };

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSegment(segment: DeepgramUtterance): TranscriptSegment | null {
  const text = String(segment.transcript ?? "").trim();
  if (!text) return null;
  const startSeconds = Number(finiteNumber(segment.start, 0).toFixed(3));
  const endSeconds = Number(finiteNumber(segment.end, startSeconds).toFixed(3));
  return {
    startSeconds,
    endSeconds: Math.max(endSeconds, startSeconds),
    text,
    confidence: Number.isFinite(Number(segment.confidence)) ? Number(segment.confidence) : null,
    speaker: Number.isFinite(Number(segment.speaker)) ? Number(segment.speaker) : null
  };
}

function extractLanguage(payload: DeepgramResponse): string | null {
  const alt = payload.results?.channels?.[0]?.alternatives?.[0];
  if (!alt) return null;
  if (typeof alt.language === "string" && alt.language.trim()) return alt.language.trim();
  if (Array.isArray(alt.languages) && typeof alt.languages[0] === "string" && alt.languages[0].trim()) {
    return alt.languages[0].trim();
  }
  return null;
}

function buildFallbackSegments(payload: DeepgramResponse): TranscriptSegment[] {
  const transcript = String(payload.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "").trim();
  if (!transcript) return [];
  return [
    {
      startSeconds: 0,
      endSeconds: 0,
      text: transcript,
      confidence: null,
      speaker: null
    }
  ];
}

export async function transcribeWithDeepgram(args: {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  mediaBuffer: Buffer;
  mediaContentType: string;
}): Promise<DeepgramTranscription> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
  const url = new URL("/v1/listen", args.baseUrl);
  url.searchParams.set("model", args.model);
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("punctuate", "true");
  url.searchParams.set("utterances", "true");
  url.searchParams.set("diarize", "true");
  url.searchParams.set("detect_language", "true");

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Token ${args.apiKey}`,
        "Content-Type": args.mediaContentType
      },
      body: args.mediaBuffer as unknown as BodyInit,
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      const error: FatalError = new Error(`deepgram request failed (${response.status}): ${detail}`);
      if (response.status === 401 || response.status === 403) {
        error.fatal = true;
      }
      throw error;
    }

    const payload = (await response.json()) as DeepgramResponse;
    const utterances = Array.isArray(payload.results?.utterances) ? payload.results?.utterances : [];

    const segments = utterances
      .map(normalizeSegment)
      .filter((segment): segment is TranscriptSegment => Boolean(segment))
      .sort((a, b) => a.startSeconds - b.startSeconds);
    const effectiveSegments = segments.length > 0 ? segments : buildFallbackSegments(payload);
    const transcriptText = effectiveSegments.map((segment) => segment.text).join("\n").trim();

    return {
      language: extractLanguage(payload) ?? "en",
      transcriptText,
      segments: effectiveSegments
    };
  } finally {
    clearTimeout(timeout);
  }
}
