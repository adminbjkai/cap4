import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DocCard } from "../components/DocCard";
import { getVideoDoc, generateVideoDoc, type DocResponse } from "../lib/api";

vi.mock("../lib/api", () => ({
  getVideoDoc: vi.fn(),
  generateVideoDoc: vi.fn(),
}));
vi.mock("../lib/format", () => ({
  buildPublicObjectUrl: (key: string) => `https://example.test/${key}`,
  formatDuration: (seconds: number) => `${Math.round(seconds)}s`,
}));

const mockGetDoc = vi.mocked(getVideoDoc);
const mockGenerate = vi.mocked(generateVideoDoc);

const COMPLETE_DOC: DocResponse = {
  id: "doc-1",
  status: "complete",
  title: "Deploy the service",
  docType: "runbook",
  markdown: "# Deploy the service\n",
  confidenceNotes: ["audio unclear at 03:10"],
  unusedFrames: [],
  promptVersion: "v1",
  model: "test-model",
  errorMessage: null,
  createdAt: "2026-06-11T00:00:00Z",
  updatedAt: "2026-06-11T00:00:00Z",
  sections: [
    {
      id: "sec-1",
      position: 0,
      heading: "Build",
      bodyMd: "Build the image first.",
      startS: 261,
      endS: 318,
      steps: [
        {
          position: 0,
          text: "Run the build",
          frameId: "frame-uuid",
          frameKey: "videos/vid-1/frames/f_0001.jpg",
          frameTs: 263,
          crop: null,
          alt: "build output",
          callout: "Takes ~2 min",
        },
      ],
    },
  ],
};

beforeEach(() => {
  mockGetDoc.mockReset();
  mockGenerate.mockReset();
});

describe("DocCard", () => {
  it("offers generation only once transcription is complete", async () => {
    mockGetDoc.mockResolvedValue(null);
    render(
      <DocCard videoId="vid-1" transcriptionStatus="processing" videoTitle="T" onSeekToSeconds={() => {}} />,
    );
    const button = await screen.findByRole("button", { name: "Generate doc" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/once transcription is complete/i)).toBeTruthy();
  });

  it("starts generation, polls, and renders the finished doc", async () => {
    mockGetDoc.mockResolvedValue(null);
    mockGenerate.mockResolvedValue({ ok: true, jobId: 1, status: "queued" });
    const onSeek = vi.fn();
    render(
      <DocCard
        videoId="vid-1"
        transcriptionStatus="complete"
        videoTitle="T"
        onSeekToSeconds={onSeek}
        pollIntervalMs={15}
      />,
    );

    const button = await screen.findByRole("button", { name: "Generate doc" });
    mockGetDoc.mockResolvedValue({ ...COMPLETE_DOC, status: "generating", sections: [] });
    fireEvent.click(button);

    expect(await screen.findByText(/Generating doc/)).toBeTruthy();
    expect(mockGenerate).toHaveBeenCalledWith("vid-1");

    // next poll returns the complete document
    mockGetDoc.mockResolvedValue(COMPLETE_DOC);
    expect(await screen.findByText("Deploy the service")).toBeTruthy();
    expect(screen.getByText("Build")).toBeTruthy();
    expect(screen.getByText("Run the build")).toBeTruthy();
    expect(screen.getByText("Takes ~2 min")).toBeTruthy();
    expect(screen.getByText("audio unclear at 03:10")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download .md" })).toBeTruthy();

    // step screenshot click jumps the player to the frame timestamp
    fireEvent.click(screen.getByAltText("build output"));
    expect(onSeek).toHaveBeenCalledWith(263);

    // section span click jumps to the section start
    fireEvent.click(screen.getByRole("button", { name: "261s–318s" }));
    expect(onSeek).toHaveBeenCalledWith(261);
  });

  it("resumes polling when a doc is already generating on mount", async () => {
    mockGetDoc.mockResolvedValue({ ...COMPLETE_DOC, status: "generating", sections: [] });
    render(
      <DocCard
        videoId="vid-1"
        transcriptionStatus="complete"
        videoTitle="T"
        onSeekToSeconds={() => {}}
        pollIntervalMs={15}
      />,
    );
    expect(await screen.findByText(/Generating doc/)).toBeTruthy();

    mockGetDoc.mockResolvedValue(COMPLETE_DOC);
    expect(await screen.findByText("Deploy the service")).toBeTruthy();
  });

  it("shows the failure and offers a retry", async () => {
    mockGetDoc.mockResolvedValue({
      ...COMPLETE_DOC,
      status: "failed",
      sections: [],
      errorMessage: "model output invalid after retry",
    });
    render(
      <DocCard videoId="vid-1" transcriptionStatus="complete" videoTitle="T" onSeekToSeconds={() => {}} />,
    );
    expect(await screen.findByText(/model output invalid after retry/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry doc generation" })).toBeTruthy();
  });

  it("surfaces a rejected generation request", async () => {
    mockGetDoc.mockResolvedValue(null);
    mockGenerate.mockRejectedValue(new Error("409 Conflict: transcript not ready"));
    render(
      <DocCard videoId="vid-1" transcriptionStatus="complete" videoTitle="T" onSeekToSeconds={() => {}} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Generate doc" }));
    await waitFor(() => {
      expect(screen.getByText(/409 Conflict/)).toBeTruthy();
    });
  });
});
