import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { VideoPage } from "../pages/VideoPage";

/* Regression test for the right-rail tab crossfade.

   Bug: the tab-transition effect depended on `renderedRailTab` while also
   setting it, so React ran the effect cleanup (cancelling the 180ms timer)
   before it fired. `outgoingRailTab` was therefore never reset to null and the
   previous tab's panel stayed mounted as an absolutely-positioned overlay —
   visible as overlapping content under prefers-reduced-motion. */

const STATUS = {
  videoId: "vid-1",
  name: "Test video",
  processingPhase: "complete",
  processingProgress: 100,
  resultKey: "out/vid-1.mp4",
  thumbnailKey: null,
  errorMessage: null,
  transcriptionStatus: "complete",
  aiStatus: "complete",
  transcriptErrorMessage: null,
  aiErrorMessage: null,
  transcript: {
    provider: "deepgram",
    language: "en",
    vttKey: "vid-1.vtt",
    text: "hello world",
    segments: [{ startSeconds: 0, text: "hello world" }],
  },
  aiOutput: {
    provider: "groq",
    model: "m",
    title: "Test video",
    summary: "A short summary.",
    keyPoints: ["Point one"],
  },
};

vi.mock("../lib/api", () => ({
  getVideoStatus: vi.fn(async () => STATUS),
  getJobStatus: vi.fn(async () => ({})),
  deleteVideo: vi.fn(async () => ({ ok: true, videoId: "vid-1", deletedAt: "" })),
  saveWatchEdits: vi.fn(async () => ({ ok: true, videoId: "vid-1", updated: { title: false, transcript: false } })),
  retryVideo: vi.fn(async () => ({ ok: true, videoId: "vid-1", jobsReset: [] })),
}));

vi.mock("../lib/sessions", () => ({ upsertRecentSession: vi.fn() }));
vi.mock("../lib/format", () => ({ buildPublicObjectUrl: (key: string) => `https://example.test/${key}` }));
vi.mock("../hooks/useKeyboardShortcuts", () => ({ useKeyboardShortcuts: vi.fn() }));

vi.mock("../components/PlayerCard", () => ({ PlayerCard: () => <div>PLAYER</div> }));
vi.mock("../components/ChapterList", () => ({ ChapterList: () => <div>CHAPTERS</div> }));
vi.mock("../components/TranscriptCard", () => ({ TranscriptCard: () => <div>TRANSCRIPT_PANEL</div> }));
vi.mock("../components/SummaryCard", () => ({ SummaryCard: () => <div>SUMMARY_PANEL</div> }));
vi.mock("../components/DocCard", () => ({ DocCard: () => <div>DOC_PANEL</div> }));

function renderVideoPage() {
  return render(
    <MemoryRouter initialEntries={["/v/vid-1"]}>
      <Routes>
        <Route path="/v/:videoId" element={<VideoPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("VideoPage right-rail tabs", () => {
  it("removes the previous panel after switching tabs (no stuck overlay)", async () => {
    renderVideoPage();

    // Default tab is Transcript.
    expect(await screen.findByText("TRANSCRIPT_PANEL")).toBeTruthy();

    // Switch to Summary.
    fireEvent.click(screen.getByRole("button", { name: "Summary" }));

    // During the crossfade the new panel mounts immediately.
    expect(screen.getByText("SUMMARY_PANEL")).toBeTruthy();

    // After the 180ms transition the outgoing Transcript panel is unmounted.
    await waitFor(() => {
      expect(screen.queryByText("TRANSCRIPT_PANEL")).toBeNull();
    });
    expect(screen.getByText("SUMMARY_PANEL")).toBeTruthy();
  });

  it("does not leave Transcript content showing under the Notes tab", async () => {
    renderVideoPage();
    expect(await screen.findByText("TRANSCRIPT_PANEL")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Notes" }));

    await waitFor(() => {
      expect(screen.queryByText("TRANSCRIPT_PANEL")).toBeNull();
    });
    // Notes panel (inline) renders its textarea.
    expect(screen.getByPlaceholderText(/private notes/i)).toBeTruthy();
  });

  it("shows the Doc tab and renders its panel when selected", async () => {
    renderVideoPage();
    expect(await screen.findByText("TRANSCRIPT_PANEL")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Doc" }));

    expect(screen.getByText("DOC_PANEL")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText("TRANSCRIPT_PANEL")).toBeNull();
    });
  });
});
