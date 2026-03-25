import { z } from 'zod';

type GroqChatCompletionResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

// Zod schemas for validation
const ChapterSchema = z.object({
  title: z.string(),
  start: z.number(),
  sentiment: z.enum(['positive', 'neutral', 'negative']).optional()
});

const EntitySchema = z.object({
  people: z.array(z.string()).optional().default([]),
  organizations: z.array(z.string()).optional().default([]),
  locations: z.array(z.string()).optional().default([]),
  dates: z.array(z.string()).optional().default([])
});

const ActionItemSchema = z.object({
  task: z.string(),
  assignee: z.string().optional(),
  deadline: z.string().optional()
});

const QuoteSchema = z.object({
  text: z.string(),
  timestamp: z.number()
});

const GroqResponseSchema = z.object({
  title: z.string().optional(),
  summary: z.string().optional(),
  key_points: z.array(z.string()).optional(),
  keyPoints: z.array(z.string()).optional(),
  chapters: z.array(ChapterSchema).optional(),
  entities: EntitySchema.optional(),
  action_items: z.array(ActionItemSchema).optional(),
  actionItems: z.array(ActionItemSchema).optional(),
  quotes: z.array(QuoteSchema).optional()
});

export type GroqChapter = {
  title: string;
  start: number; // seconds from start
  sentiment?: 'positive' | 'neutral' | 'negative';
};

export type GroqEntity = {
  people: string[];
  organizations: string[];
  locations: string[];
  dates: string[];
};

export type GroqActionItem = {
  task: string;
  assignee?: string;
  deadline?: string;
};

export type GroqQuote = {
  text: string;
  timestamp: number;
};

export type GroqSummary = {
  model: string;
  title: string;
  summary: string;
  keyPoints: string[];
  chapters: GroqChapter[];
  entities?: GroqEntity;
  actionItems?: GroqActionItem[];
  quotes?: GroqQuote[];
};

type FatalError = Error & { fatal?: boolean };

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

function normalizeChapters(value: unknown): GroqChapter[] {
  if (!Array.isArray(value)) return [];
  const chapters: GroqChapter[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const title = "title" in item && typeof item.title === "string" ? item.title.trim() : "";
    const start = "start" in item && typeof item.start === "number" ? item.start :
                 ("startSeconds" in item && typeof item.startSeconds === "number" ? item.startSeconds : 0);
    const sentiment = "sentiment" in item &&
                     (item.sentiment === 'positive' || item.sentiment === 'neutral' || item.sentiment === 'negative')
                     ? item.sentiment : undefined;
    if (!title) continue;
    chapters.push({ title, start, sentiment });
  }
  return chapters;
}

function normalizeEntities(value: unknown): GroqEntity {
  const defaultEntity: GroqEntity = { people: [], organizations: [], locations: [], dates: [] };
  if (!value || typeof value !== "object") return defaultEntity;

  const obj = value as Record<string, unknown>;
  return {
    people: Array.isArray(obj.people) ? obj.people.filter((p): p is string => typeof p === "string") : [],
    organizations: Array.isArray(obj.organizations) ? obj.organizations.filter((o): o is string => typeof o === "string") : [],
    locations: Array.isArray(obj.locations) ? obj.locations.filter((l): l is string => typeof l === "string") : [],
    dates: Array.isArray(obj.dates) ? obj.dates.filter((d): d is string => typeof d === "string") : []
  };
}

function normalizeActionItems(value: unknown): GroqActionItem[] {
  if (!Array.isArray(value)) return [];
  const items: GroqActionItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const task = "task" in item && typeof item.task === "string" ? item.task.trim() : "";
    if (!task) continue;
    const assignee = "assignee" in item && typeof item.assignee === "string" ? item.assignee.trim() : undefined;
    const deadline = "deadline" in item && typeof item.deadline === "string" ? item.deadline.trim() : undefined;
    items.push({ task, assignee, deadline });
  }
  return items;
}

function normalizeQuotes(value: unknown): GroqQuote[] {
  if (!Array.isArray(value)) return [];
  const quotes: GroqQuote[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const text = "text" in item && typeof item.text === "string" ? item.text.trim() : "";
    const timestamp = "timestamp" in item && typeof item.timestamp === "number" ? item.timestamp :
                     ("time" in item && typeof item.time === "number" ? item.time : 0);
    if (!text) continue;
    quotes.push({ text, timestamp });
  }
  return quotes;
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
  const systemPrompt = `You are Cap AI, an expert at analyzing video content and creating structured summaries.

Analyze this transcript and return a JSON response:
{
  "title": "string (concise, specific title — 4-10 words — that names the exact topic or purpose)",
  "summary": "string (comprehensive summary. For meetings: decisions made, action items, key discussion points. For tutorials: all steps and concepts. For presentations: main arguments and supporting evidence. Use first person if the speaker is presenting, e.g. 'In this video, I cover...'. Long enough that someone could understand the full content without watching — several paragraphs for longer recordings.)",
  "key_points": ["string", ...],
  "chapters": [{"title": "string", "start": number, "sentiment": "positive|neutral|negative"}, ...],
  "entities": {
    "people": ["string", ...],
    "organizations": ["string", ...],
    "locations": ["string", ...],
    "dates": ["string", ...]
  },
  "action_items": [{"task": "string", "assignee": "string (optional)", "deadline": "string (optional)"}, ...],
  "quotes": [{"text": "string (exact quote from transcript)", "timestamp": number}, ...]
}

key_points rules — critical for chapter navigation:
- Each key point MUST be 4-9 words, no more
- Use the EXACT words and phrases spoken in the transcript — not paraphrases
- Focus on nouns, verbs, and proper nouns that are distinctive to that moment
- Good: "database migration runs every Sunday night" — Bad: "The team discussed their approach to database maintenance schedules"
- Aim for 5-10 key points that cover distinct moments spread across the video

chapters rules:
- Mark each major topic change with a descriptive title, start time (seconds), and sentiment
- Minimum 30 seconds between chapters (merge topics closer than 30s)
- Maximum 12 chapters (prioritize the most significant topic boundaries)
- Aim for 4-8 chapters for typical videos
- Chapter titles should be specific (name the topic, not just "Introduction")
- Sentiment: positive (optimistic, successful, upbeat), neutral (informational, balanced), negative (problems, challenges, critical)

entities rules:
- Extract all mentioned people (full names when available)
- Extract all organizations, companies, products, projects
- Extract all locations (cities, countries, venues)
- Extract all dates, times, deadlines mentioned

action_items rules (for meeting-style content):
- Extract concrete tasks or to-dos mentioned
- Include assignee if a person is named for the task
- Include deadline if a specific time/date is mentioned
- Omit if not a meeting or no clear action items exist

quotes rules:
- Extract 3-5 notable, meaningful quotes from the transcript
- Use exact wording from the transcript
- Include timestamp in seconds where the quote appears
- Choose quotes that capture key insights, decisions, or memorable moments

Return ONLY valid JSON without markdown or code fences.`;

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
      const error: FatalError = new Error(`groq request failed (${response.status}): ${detail}`);
      if (response.status === 401 || response.status === 403) {
        error.fatal = true;
      }
      throw error;
    }

    const payload = (await response.json()) as GroqChatCompletionResponse;
    const message = payload.choices?.[0]?.message?.content;
    if (!message) {
      throw new Error("groq response did not include message content");
    }

    const parsed = parseJsonObject(message);

    // Validate with Zod schema
    const validationResult = GroqResponseSchema.safeParse(parsed);
    const validated = validationResult.success ? validationResult.data : parsed;

    const title = toNonEmptyString(validated.title, "Untitled summary");
    const summary = toNonEmptyString(validated.summary, "No summary available.");
    const keyPoints = normalizeKeyPoints(validated.key_points ?? validated.keyPoints);
    const chapters = normalizeChapters(validated.chapters).slice(0, 12); // Cap at 12 chapters
    const entities = validated.entities ? normalizeEntities(validated.entities) : undefined;
    const actionItems = normalizeActionItems(validated.action_items ?? validated.actionItems);
    const quotes = normalizeQuotes(validated.quotes);

    return {
      model: String(payload.model ?? args.model),
      title,
      summary,
      keyPoints,
      chapters,
      entities: entities && (entities.people.length > 0 || entities.organizations.length > 0 ||
                entities.locations.length > 0 || entities.dates.length > 0) ? entities : undefined,
      actionItems: actionItems.length > 0 ? actionItems : undefined,
      quotes: quotes.length > 0 ? quotes : undefined
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
  const chunkSummaries: {
    summary: string;
    keyPoints: string[];
    chapters: GroqChapter[];
    entities?: GroqEntity;
    actionItems?: GroqActionItem[];
    quotes?: GroqQuote[];
  }[] = [];

  let failedChunks = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunkPrompt = `You are Cap AI, an expert at analyzing video content. This is section ${i + 1} of ${chunks.length} from a longer video.

Analyze this section and provide JSON:
{
  "summary": "string (detailed summary of this section — capture all topics, decisions, concepts, and action items. Include specific names, numbers, and conclusions. Minimum 3 sentences. This will be combined with other sections into a full overview.)",
  "key_points": ["string", ...],
  "chapters": [{"title": "string", "start": number, "sentiment": "positive|neutral|negative"}],
  "entities": {
    "people": ["string", ...],
    "organizations": ["string", ...],
    "locations": ["string", ...],
    "dates": ["string", ...]
  },
  "action_items": [{"task": "string", "assignee": "string (optional)", "deadline": "string (optional)"}],
  "quotes": [{"text": "string (exact quote)", "timestamp": number}]
}

key_points rules:
- Each point MUST be 4-9 words, no more
- Use the EXACT words and phrases from the transcript — not paraphrases
- Focus on nouns, verbs, and proper nouns distinctive to each moment
- Example: "authentication token expires after 24 hours" not "The speaker explained the token expiry policy"

chapters: one entry per major topic shift in this section, with title, start time (seconds from beginning of full video), and sentiment.

entities: extract all people, organizations, locations, and dates mentioned in this section.

action_items: extract concrete tasks mentioned (if meeting-style content).

quotes: 1-3 notable quotes from this section with timestamps.

Return ONLY valid JSON without any markdown or code fences.

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
        const validationResult = GroqResponseSchema.safeParse(parsed);
        const validated = validationResult.success ? validationResult.data : parsed;

        const entities = validated.entities ? normalizeEntities(validated.entities) : undefined;
        const actionItems = normalizeActionItems(validated.action_items ?? validated.actionItems);
        const quotes = normalizeQuotes(validated.quotes);

        chunkSummaries.push({
          summary: toNonEmptyString(validated.summary, ""),
          keyPoints: normalizeKeyPoints(validated.key_points ?? validated.keyPoints),
          chapters: normalizeChapters(validated.chapters),
          entities: entities && (entities.people.length > 0 || entities.organizations.length > 0 ||
                    entities.locations.length > 0 || entities.dates.length > 0) ? entities : undefined,
          actionItems: actionItems.length > 0 ? actionItems : undefined,
          quotes: quotes.length > 0 ? quotes : undefined
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({ chunk: i, totalChunks: chunks.length, error: message }));
      failedChunks++;
    }
  }

  if (failedChunks > 0 && failedChunks / chunks.length > 0.3) {
    throw new Error(`Groq enrichment failed: ${failedChunks}/${chunks.length} chunks errored`);
  }

  // Synthesize final summary from chunk summaries
  const allKeyPoints = chunkSummaries.flatMap(c => c.keyPoints);
  const allChapters = chunkSummaries.flatMap(c => c.chapters);

  // Deduplicate chapters by start time (within 30 seconds) and cap at 12
  const dedupedChapters: GroqChapter[] = [];
  for (const chapter of allChapters.sort((a, b) => a.start - b.start)) {
    const lastChapter = dedupedChapters[dedupedChapters.length - 1];
    if (!lastChapter || Math.abs(chapter.start - lastChapter.start) >= 30) {
      dedupedChapters.push(chapter);
    }
  }
  const cappedChapters = dedupedChapters.slice(0, 12);

  // Merge entities from all chunks
  const mergedEntities: GroqEntity = {
    people: [...new Set(chunkSummaries.flatMap(c => c.entities?.people ?? []))],
    organizations: [...new Set(chunkSummaries.flatMap(c => c.entities?.organizations ?? []))],
    locations: [...new Set(chunkSummaries.flatMap(c => c.entities?.locations ?? []))],
    dates: [...new Set(chunkSummaries.flatMap(c => c.entities?.dates ?? []))]
  };

  // Merge action items and quotes
  const allActionItems = chunkSummaries.flatMap(c => c.actionItems ?? []);
  const allQuotes = chunkSummaries.flatMap(c => c.quotes ?? []);

  const sectionDetails = chunkSummaries
    .map((c, i) => `Section ${i + 1}:\n${c.summary}`)
    .join("\n\n");

  const entitiesSummary = (mergedEntities.people.length > 0 || mergedEntities.organizations.length > 0 ||
                          mergedEntities.locations.length > 0 || mergedEntities.dates.length > 0)
    ? `\n\nEntities mentioned across sections:\n${
        mergedEntities.people.length > 0 ? `People: ${mergedEntities.people.join(', ')}\n` : ''
      }${
        mergedEntities.organizations.length > 0 ? `Organizations: ${mergedEntities.organizations.join(', ')}\n` : ''
      }${
        mergedEntities.locations.length > 0 ? `Locations: ${mergedEntities.locations.join(', ')}\n` : ''
      }${
        mergedEntities.dates.length > 0 ? `Dates: ${mergedEntities.dates.join(', ')}` : ''
      }` : '';

  const actionItemsSummary = allActionItems.length > 0
    ? `\n\nAction items identified:\n${allActionItems.map((a, i) => `${i + 1}. ${a.task}${a.assignee ? ` (${a.assignee})` : ''}${a.deadline ? ` - ${a.deadline}` : ''}`).join('\n')}`
    : '';

  const finalPrompt = `You are Cap AI, an expert at synthesizing information into comprehensive, well-organized summaries.

Based on these detailed section analyses of a video, create a thorough final summary that captures EVERYTHING important.

Section analyses:
${sectionDetails}

${allKeyPoints.length > 0 ? `All key points identified:\n${allKeyPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n` : ""}${entitiesSummary}${actionItemsSummary}

Provide JSON in the following format:
{
  "title": "string (concise but descriptive title that captures the main topic/purpose)",
  "summary": "string (COMPREHENSIVE summary that covers the entire video thoroughly. This should be detailed enough that someone could understand all the important content without watching. Include: main topics covered, key decisions or conclusions, important details mentioned, action items if any. Organize it logically - for meetings use topics/agenda items, for tutorials use steps/concepts, for presentations use main arguments. Write from 1st person perspective if appropriate. This should be several paragraphs for longer content.)",
  "key_points": ["string (specific key point or takeaway)", ...],
  "quotes": [{"text": "string (exact notable quote from transcript)", "timestamp": number}, ...]
}

The summary must be detailed and comprehensive - not a brief overview. Capture all the important information from every section.
For quotes, select 3-5 of the most notable, insightful, or memorable quotes from those provided.
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
    const validationResult = GroqResponseSchema.safeParse(parsed);
    const validated = validationResult.success ? validationResult.data : parsed;

    const title = toNonEmptyString(validated.title, "Untitled summary");
    const summary = toNonEmptyString(validated.summary, "No summary available.");
    const keyPoints = normalizeKeyPoints(validated.key_points ?? validated.keyPoints);
    const synthesisQuotes = normalizeQuotes(validated.quotes);

    // Use the best quotes from synthesis (limit to 5)
    const finalQuotes = synthesisQuotes.length > 0
      ? synthesisQuotes.slice(0, 5)
      : allQuotes.slice(0, 5);

    return {
      model: String(payload.model ?? args.model),
      title,
      summary,
      keyPoints,
      chapters: cappedChapters,
      entities: (mergedEntities.people.length > 0 || mergedEntities.organizations.length > 0 ||
                mergedEntities.locations.length > 0 || mergedEntities.dates.length > 0)
                ? mergedEntities : undefined,
      actionItems: allActionItems.length > 0 ? allActionItems : undefined,
      quotes: finalQuotes.length > 0 ? finalQuotes : undefined
    };
  } finally {
    clearTimeout(timeout);
  }
}
