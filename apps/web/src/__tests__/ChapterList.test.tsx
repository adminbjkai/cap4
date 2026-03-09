import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChapterList } from "../components/ChapterList";

const CHAPTERS = [
  { title: "Introduction", seconds: 0 },
  { title: "Setup and installation", seconds: 45 },
  { title: "Core concepts explained", seconds: 120 },
  { title: "Advanced usage", seconds: 240 }
];

describe("ChapterList", () => {
  it("renders chapter titles", () => {
    render(
      <ChapterList
        chapters={CHAPTERS}
        currentSeconds={0}
        durationSeconds={300}
        onSeek={vi.fn()}
      />
    );
    expect(screen.getByText("Introduction")).toBeTruthy();
    expect(screen.getByText("Setup and installation")).toBeTruthy();
    expect(screen.getByText("Core concepts explained")).toBeTruthy();
    expect(screen.getByText("Advanced usage")).toBeTruthy();
  });

  it("renders formatted timestamps for each chapter", () => {
    render(
      <ChapterList
        chapters={CHAPTERS}
        currentSeconds={0}
        durationSeconds={300}
        onSeek={vi.fn()}
      />
    );
    expect(screen.getByText("00:00")).toBeTruthy();
    expect(screen.getByText("00:45")).toBeTruthy();
    expect(screen.getByText("02:00")).toBeTruthy();
    expect(screen.getByText("04:00")).toBeTruthy();
  });

  it("calls onSeek with correct seconds when chapter is clicked", () => {
    const onSeek = vi.fn();
    render(
      <ChapterList
        chapters={CHAPTERS}
        currentSeconds={0}
        durationSeconds={300}
        onSeek={onSeek}
      />
    );
    fireEvent.click(screen.getByText("Setup and installation"));
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(45);
  });

  it("calls onSeek with 0 when Introduction is clicked", () => {
    const onSeek = vi.fn();
    render(
      <ChapterList
        chapters={CHAPTERS}
        currentSeconds={50}
        durationSeconds={300}
        onSeek={onSeek}
      />
    );
    fireEvent.click(screen.getByText("Introduction"));
    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it("calls onSeek with correct seconds for every chapter", () => {
    const onSeek = vi.fn();
    render(
      <ChapterList
        chapters={CHAPTERS}
        currentSeconds={0}
        durationSeconds={300}
        onSeek={onSeek}
      />
    );
    fireEvent.click(screen.getByText("Advanced usage"));
    expect(onSeek).toHaveBeenCalledWith(240);
  });

  it("highlights the active chapter based on currentSeconds", () => {
    const { container } = render(
      <ChapterList
        chapters={CHAPTERS}
        currentSeconds={60}
        durationSeconds={300}
        onSeek={vi.fn()}
      />
    );
    // At 60s, chapter index 1 (45s) is active, chapter 2 (120s) is not yet
    const buttons = container.querySelectorAll("button");
    // Active chapter button (index 1) should have the active row class
    expect(buttons[1]?.className).toContain("chapter-row-active");
    // Non-active should not
    expect(buttons[2]?.className).not.toContain("chapter-row-active");
  });

  it("filters out chapters beyond durationSeconds", () => {
    render(
      <ChapterList
        chapters={[...CHAPTERS, { title: "Beyond end", seconds: 400 }]}
        currentSeconds={0}
        durationSeconds={300}
        onSeek={vi.fn()}
      />
    );
    expect(screen.queryByText("Beyond end")).toBeNull();
  });

  it("shows empty state when no chapters", () => {
    render(
      <ChapterList
        chapters={[]}
        currentSeconds={0}
        durationSeconds={300}
        onSeek={vi.fn()}
      />
    );
    expect(screen.getByText("No chapters available for this video.")).toBeTruthy();
  });

  it("shows chapter count in footer", () => {
    render(
      <ChapterList
        chapters={CHAPTERS}
        currentSeconds={50}
        durationSeconds={300}
        onSeek={vi.fn()}
      />
    );
    // "Chapter X of Y"
    expect(screen.getByText(/of/)).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
  });

  it("shows hours in timestamp for chapters >= 3600s", () => {
    render(
      <ChapterList
        chapters={[{ title: "Long chapter", seconds: 3661 }]}
        currentSeconds={0}
        durationSeconds={7200}
        onSeek={vi.fn()}
      />
    );
    expect(screen.getByText("01:01:01")).toBeTruthy();
  });
});
