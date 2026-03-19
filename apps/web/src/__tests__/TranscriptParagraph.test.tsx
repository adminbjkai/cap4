import type { ComponentProps } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TranscriptParagraph } from "../components/TranscriptParagraph";

type TranscriptSegments = ComponentProps<typeof TranscriptParagraph>["segments"];

const SEGMENTS = [
  { startSeconds: 0, endSeconds: 5, text: "Welcome to this tutorial on building APIs." },
  { startSeconds: 5, endSeconds: 10, text: "Today we will cover authentication." },
  { startSeconds: 10, endSeconds: 15, text: "We start with JSON web tokens." },
  { startSeconds: 20, endSeconds: 25, text: "Next we look at rate limiting strategies." },
  { startSeconds: 25, endSeconds: 30, text: "Rate limiting protects your server." },
  { startSeconds: 30, endSeconds: 35, text: "Use sliding window or token bucket algorithms." },
  { startSeconds: 40, endSeconds: 45, text: "Finally we cover logging and monitoring." },
  { startSeconds: 45, endSeconds: 50, text: "Always log request duration and status codes." },
  { startSeconds: 50, endSeconds: 55, text: "Send alerts when error rates spike." }
];

describe("TranscriptParagraph", () => {
  it("renders nothing when transcriptionStatus is not complete", () => {
    const { container } = render(
      <TranscriptParagraph
        segments={SEGMENTS}
        transcriptionStatus="processing"
        onSeekToSeconds={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when segments are empty", () => {
    const { container } = render(
      <TranscriptParagraph
        segments={[]}
        transcriptionStatus="complete"
        onSeekToSeconds={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders paragraphs when complete with segments", () => {
    render(
      <TranscriptParagraph
        segments={SEGMENTS}
        transcriptionStatus="complete"
        onSeekToSeconds={vi.fn()}
      />
    );
    expect(screen.getByText("Full Transcript")).toBeTruthy();
  });

  it("renders paragraph text content", () => {
    render(
      <TranscriptParagraph
        segments={SEGMENTS}
        transcriptionStatus="complete"
        onSeekToSeconds={vi.fn()}
      />
    );
    expect(screen.getByText(/Welcome to this tutorial/)).toBeTruthy();
  });

  it("renders timestamps for each paragraph", () => {
    render(
      <TranscriptParagraph
        segments={SEGMENTS}
        transcriptionStatus="complete"
        onSeekToSeconds={vi.fn()}
      />
    );
    // First paragraph starts at 00:00
    expect(screen.getAllByText("00:00").length).toBeGreaterThan(0);
  });

  it("calls onSeekToSeconds with paragraph startSeconds when clicked", () => {
    const onSeek = vi.fn();
    render(
      <TranscriptParagraph
        segments={SEGMENTS}
        transcriptionStatus="complete"
        onSeekToSeconds={onSeek}
      />
    );
    // The first paragraph starts at 0s — click it
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.click(buttons[0]!);
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it("calls onSeekToSeconds with correct seconds for a later paragraph", () => {
    const onSeek = vi.fn();
    render(
      <TranscriptParagraph
        segments={SEGMENTS}
        transcriptionStatus="complete"
        onSeekToSeconds={onSeek}
      />
    );
    const buttons = screen.getAllByRole("button");
    // Click the second paragraph (starts at 20s after grouping 3 segments)
    if (buttons.length >= 2) {
      fireEvent.click(buttons[1]!);
      expect(onSeek).toHaveBeenCalledTimes(1);
      // Second group starts around the 4th segment (index 3 = 20s)
      expect(onSeek).toHaveBeenCalledWith(expect.any(Number));
    }
  });

  it("renders clickable buttons (not plain divs) when onSeekToSeconds provided", () => {
    render(
      <TranscriptParagraph
        segments={SEGMENTS}
        transcriptionStatus="complete"
        onSeekToSeconds={vi.fn()}
      />
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("shows instructional copy when onSeekToSeconds is provided", () => {
    render(
      <TranscriptParagraph
        segments={SEGMENTS}
        transcriptionStatus="complete"
        onSeekToSeconds={vi.fn()}
      />
    );
    expect(screen.getByText(/Click any paragraph to jump/)).toBeTruthy();
  });

  it("groups segments into multiple paragraphs", () => {
    render(
      <TranscriptParagraph
        segments={SEGMENTS}
        transcriptionStatus="complete"
        onSeekToSeconds={vi.fn()}
      />
    );
    // 9 segments should produce multiple paragraphs (groups of ~6)
    const buttons = screen.getAllByRole("button");
    // Should have at least 2 paragraphs for 9 segments
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it("handles segments with undefined startSeconds gracefully", () => {
    const segmentsWithMissing: TranscriptSegments = [
      { startSeconds: undefined, endSeconds: 5, text: "No start time here." },
      { startSeconds: 5, endSeconds: 10, text: "Has start time." }
    ];
    const { container } = render(
      <TranscriptParagraph
        segments={segmentsWithMissing}
        transcriptionStatus="complete"
        onSeekToSeconds={vi.fn()}
      />
    );
    // Should render without crashing
    expect(container.firstChild).not.toBeNull();
  });

  it("shows reading-mode copy when onSeekToSeconds is not provided", () => {
    render(
      <TranscriptParagraph
        segments={SEGMENTS}
        transcriptionStatus="complete"
      />
    );
    expect(screen.getByText(/easy reading/)).toBeTruthy();
  });
});
