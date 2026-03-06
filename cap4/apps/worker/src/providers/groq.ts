type GroqChatCompletionResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export type GroqChapter = {
  title: string;
  start: number; // seconds from start
};

export type GroqSummary = {
  model: string;
  title: string;
  summary: string;
  keyPoints: string[];
  chapters: GroqChapter[];
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

function normalizeChapters(value: unknown): Array<{ title: string; start: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const title = "title" in item && typeof item.title === "string" ? item.title.trim() : "";
      const start = "start" in item && typeof item.start === "number" ? item.start : 
                   ("startSeconds" in item && typeof item.startSeconds === "number" ? item.startSeconds : 0);
      if (!title) return null;
      return { title, start };
    })
    .filter((entry): entry is { title: string; start: number } => entry !== null);
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
  
  // Chunk transcript if too long (24k chars per chunk like reference)
  const MAX_CHARS = 24000;
  let transcriptChunks: string[] = [];
  if (args.transcript.length > MAX_CHARS) {
    // Simple chunking by paragraphs to avoid cutting mid-sentence
    const paragraphs = args.transcript.split(/\n+/);
    let currentChunk = "";
    for (const para of paragraphs) {
      if ((currentChunk + para).length > MAX_CHARS && currentChunk.length > 0) {
        transcriptChunks.push(currentChunk.trim());
        currentChunk = para;
      } else {
        currentChunk += (currentChunk ? "\n" : "") + para;
      }
    }
    if (currentChunk) transcriptChunks.push(currentChunk.trim());
  } else {
    transcriptChunks = [args.transcript];
  }

  // Process single chunk or multiple chunks
  if (transcriptChunks.length === 1) {
    return generateSingleChunk(url, args, transcriptChunks[0]!, controller, timeout);
  }
  
  return generateMultipleChunks(url, args, transcriptChunks, controller, timeout);
}

async function generateSingleChunk(
  url: URL,
  args: { apiKey: string; model: string; timeoutMs: number },
  transcript: string,
  controller: AbortController,
  timeout: ReturnType<typeof setTimeout>
): Promise<GroqSummary> {
  const systemPrompt = `You are Cap AI, an expert at analyzing video content and creating comprehensive summaries.

Analyze this transcript thoroughly and provide a detailed JSON response:
{
  "title": "string (concise but descriptive title that captures the main topic)",
  "summary": "string (detailed summary that covers ALL key points discussed. For meetings: include decisions made, action items, and key discussion points. For tutorials: cover all steps and concepts explained. For presentations: summarize all main arguments and supporting points. Write from 1st person perspective if the speaker is teaching/presenting, e.g. 'In this video, I walk through...'. Make it comprehensive enough that someone could understand the full content without watching. This should be several paragraphs for longer content.)",
  "key_points": ["string (specific key point or takeaway)", ...],
  "chapters": [{"title": "string (descriptive chapter title)", "start": number (seconds from start)}, ...]
}

Guidelines:
- The summary should be detailed and comprehensive, not a brief overview
- Capture ALL important topics, not just the main theme
- For longer content, organize the summary by topic or chronologically
- Include specific details, names, numbers, and conclusions mentioned
- Write in a natural, flowing narrative style
- Use first person when the speaker is presenting/teaching
- Chapters should mark distinct topic changes or sections (aim for 4-8 chapters depending on video length)

Return ONLY valid JSON without any markdown formatting or code blocks.`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: args.model,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Transcript:\n${transcript}` }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      const error = new Error(`groq request failed (${response.status}): ${detail}`);
      if (response.status === 401 || response.status === 403) {
        (error as any).fatal = true;
      }
      throw error;
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
    const chapters = normalizeChapters(parsed.chapters);

    return {
      model: String(payload.model ?? args.model),
      title,
      summary,
      keyPoints,
      chapters
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function generateMultipleChunks(
  url: URL,
  args: { apiKey: string; model: string; timeoutMs: number },
  chunks: string[],
  controller: AbortController,
  timeout: ReturnType<typeof setTimeout>
): Promise<GroqSummary> {
  // Process each chunk individually
  const chunkSummaries: { summary: string; keyPoints: string[]; chapters: Array<{ title: string; start: number }> }[] = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const chunkPrompt = `You are Cap AI, an expert at analyzing video content. This is section ${i + 1} of ${chunks.length} from a longer video.

Analyze this section thoroughly and provide JSON:
{
  "summary": "string (detailed summary of this section - capture ALL key points, topics discussed, decisions made, or concepts explained. Include specific details like names, numbers, action items, and conclusions. This should be 3-6 sentences minimum.)",
  "key_points": ["string (specific key point or takeaway)", ...],
  "chapters": [{"title": "string (descriptive title for this topic/section)", "start": number (seconds from video start)}]
}

Be thorough - this summary will be combined with other sections to create a comprehensive overview.
Return ONLY valid JSON without any markdown formatting or code blocks.

Transcript section:
${chunks[i]}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${args.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: args.model,
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You are Cap AI, an expert at analyzing video content." },
            { role: "user", content: chunkPrompt }
          ]
        }),
        signal: controller.signal
      });

      if (!response.ok) continue;

      const payload = (await response.json()) as GroqChatCompletionResponse;
      const message = payload.choices?.[0]?.message?.content;
      if (message) {
        const parsed = parseJsonObject(message);
        chunkSummaries.push({
          summary: toNonEmptyString(parsed.summary, ""),
          keyPoints: normalizeKeyPoints(parsed.key_points ?? parsed.keyPoints),
          chapters: normalizeChapters(parsed.chapters)
        });
      }
    } catch {
      // Continue to next chunk
    }
  }

  // Synthesize final summary from chunk summaries
  const allKeyPoints = chunkSummaries.flatMap(c => c.keyPoints);
  const allChapters = chunkSummaries.flatMap(c => c.chapters);
  // Deduplicate chapters by start time (within 30 seconds)
  const dedupedChapters: Array<{ title: string; start: number }> = [];
  for (const chapter of allChapters.sort((a, b) => a.start - b.start)) {
    const lastChapter = dedupedChapters[dedupedChapters.length - 1];
    if (!lastChapter || Math.abs(chapter.start - lastChapter.start) >= 30) {
      dedupedChapters.push(chapter);
    }
  }
  
  const sectionDetails = chunkSummaries
    .map((c, i) => `Section ${i + 1}:\n${c.summary}`)
    .join("\n\n");

  const finalPrompt = `You are Cap AI, an expert at synthesizing information into comprehensive, well-organized summaries.

Based on these detailed section analyses of a video, create a thorough final summary that captures EVERYTHING important.

Section analyses:
${sectionDetails}

${allKeyPoints.length > 0 ? `All key points identified:\n${allKeyPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n` : ""}

Provide JSON in the following format:
{
  "title": "string (concise but descriptive title that captures the main topic/purpose)",
  "summary": "string (COMPREHENSIVE summary that covers the entire video thoroughly. This should be detailed enough that someone could understand all the important content without watching. Include: main topics covered, key decisions or conclusions, important details mentioned, action items if any. Organize it logically - for meetings use topics/agenda items, for tutorials use steps/concepts, for presentations use main arguments. Write from 1st person perspective if appropriate. This should be several paragraphs for longer content.)",
  "key_points": ["string (specific key point or takeaway)", ...]
}

The summary must be detailed and comprehensive - not a brief overview. Capture all the important information from every section.
Return ONLY valid JSON without any markdown formatting or code blocks.`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: args.model,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are Cap AI, an expert at synthesizing information." },
          { role: "user", content: finalPrompt }
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
      keyPoints,
      chapters: dedupedChapters
    };
  } finally {
    clearTimeout(timeout);
  }
}
