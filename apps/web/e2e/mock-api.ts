import type { Page } from "@playwright/test";

export const MOCK_VIDEO_ID = "00000000-0000-0000-0000-000000000001";

export const MOCK_VIDEO_STATUS = {
  videoId: MOCK_VIDEO_ID,
  name: "API Architecture Walkthrough",
  processingPhase: "complete",
  processingProgress: 100,
  resultKey: "cap4/00000000-0000-0000-0000-000000000001/result.mp4",
  thumbnailKey: "cap4/00000000-0000-0000-0000-000000000001/thumb.jpg",
  errorMessage: null,
  transcriptionStatus: "complete",
  aiStatus: "complete",
  transcriptErrorMessage: null,
  aiErrorMessage: null,
  durationSeconds: 300,
  transcript: {
    provider: "deepgram",
    language: "en",
    vttKey: "cap4/00000000-0000-0000-0000-000000000001/transcript.vtt",
    text: "Welcome to this demonstration. Today we cover API architecture. Let us begin with the basics.",
    segments: [
      { startSeconds: 0, endSeconds: 5, text: "Welcome to this demonstration." },
      { startSeconds: 5, endSeconds: 12, text: "Today we cover API architecture." },
      { startSeconds: 12, endSeconds: 20, text: "Let us begin with the basics." },
      { startSeconds: 20, endSeconds: 28, text: "First, we define our endpoints clearly." },
      { startSeconds: 28, endSeconds: 36, text: "Authentication is the next consideration." },
      { startSeconds: 36, endSeconds: 44, text: "We use JSON web tokens for auth." },
      { startSeconds: 44, endSeconds: 52, text: "Rate limiting protects against abuse." },
      { startSeconds: 52, endSeconds: 60, text: "Finally, logging ties everything together." },
      { startSeconds: 60, endSeconds: 68, text: "In summary, good APIs require planning." }
    ]
  },
  aiOutput: {
    provider: "groq",
    model: "llama-3.1-8b-instant",
    title: "Building APIs: Architecture and Best Practices",
    summary: "In this video, I walk through the core concepts of API architecture including authentication, rate limiting, and logging.",
    chapters: [
      { title: "Define endpoints clearly", seconds: 20 },
      { title: "Authentication and tokens", seconds: 28 },
      { title: "Rate limiting", seconds: 44 },
      { title: "Logging and wrap-up", seconds: 52 }
    ],
    entities: {
      people: ["Murry"],
      organizations: ["Cap4"],
      locations: [],
      dates: ["2026-03-24"]
    },
    actionItems: [
      { task: "Review the staging deploy", assignee: "Murry", deadline: "2026-03-31" }
    ],
    quotes: [
      { text: "Keep the queue monotonic.", timestamp: 52 }
    ],
    keyPoints: [
      "define endpoints clearly",
      "JSON web tokens for auth",
      "rate limiting protects against abuse",
      "logging ties everything together"
    ]
  }
};

export const MOCK_PROVIDER_STATUS = {
  checkedAt: new Date().toISOString(),
  providers: [
    {
      key: "deepgram",
      label: "Deepgram",
      purpose: "transcription",
      state: "healthy",
      configured: true,
      baseUrl: "https://api.deepgram.com",
      model: "nova-2",
      lastSuccessAt: new Date().toISOString(),
      lastJob: null
    },
    {
      key: "groq",
      label: "Groq",
      purpose: "ai",
      state: "healthy",
      configured: true,
      baseUrl: "https://api.groq.com/openai/v1",
      model: "llama-3.1-8b-instant",
      lastSuccessAt: new Date().toISOString(),
      lastJob: null
    }
  ]
};

export const MOCK_LIBRARY = {
  items: [
    {
      videoId: MOCK_VIDEO_ID,
      displayTitle: "Building APIs: Architecture and Best Practices",
      hasThumbnail: false,
      hasResult: true,
      thumbnailKey: null,
      processingPhase: "complete",
      transcriptionStatus: "complete",
      aiStatus: "complete",
      createdAt: new Date().toISOString(),
      durationSeconds: 300
    }
  ],
  sort: "created_desc",
  limit: 20,
  nextCursor: null
};

/** Install route mocks for all API calls the app makes */
export async function mockApiRoutes(page: Page) {
  await page.route(`**/api/videos/${MOCK_VIDEO_ID}/status`, (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(MOCK_VIDEO_STATUS) })
  );
  await page.route("**/api/system/provider-status", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(MOCK_PROVIDER_STATUS) })
  );
  await page.route("**/api/library/videos**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(MOCK_LIBRARY) })
  );
  // Block media requests that would fail (video, thumbnail)
  await page.route("**/*.mp4", (route) => route.abort());
  await page.route("**/*.jpg", (route) => route.abort());
}
