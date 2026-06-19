import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HomePage } from "../pages/HomePage";

/* Regression tests for the library grid/list view: EST date columns, sortable
   headers, search, per-column filtering, clear-all, and column visibility. */

const ITEMS = [
  {
    videoId: "v1",
    displayTitle: "Beta clip",
    hasThumbnail: false,
    hasResult: true,
    thumbnailKey: null,
    processingPhase: "complete",
    transcriptionStatus: "complete",
    aiStatus: "complete",
    createdAt: "2026-06-01T10:00:00.000Z",
    originalFileCreatedAt: "2024-01-15T10:30:00.000Z",
    durationSeconds: 65,
  },
  {
    videoId: "v2",
    displayTitle: "Alpha clip",
    hasThumbnail: false,
    hasResult: true,
    thumbnailKey: null,
    processingPhase: "processing",
    transcriptionStatus: "processing",
    aiStatus: "not_started",
    createdAt: "2026-06-02T10:00:00.000Z",
    originalFileCreatedAt: null,
    durationSeconds: 130,
  },
];

vi.mock("../lib/api", () => ({
  getLibraryVideos: vi.fn(async () => ({ items: ITEMS, sort: "created_desc", limit: 20, nextCursor: null })),
  getSystemProviderStatus: vi.fn(async () => ({ checkedAt: "2026-06-05T00:00:00.000Z", providers: [] })),
  deleteVideo: vi.fn(async () => ({ ok: true, videoId: "v1", deletedAt: "" })),
}));

vi.mock("../components/ProviderStatusPanel", () => ({ ProviderStatusPanel: () => <div /> }));

function renderHome() {
  localStorage.clear();
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

function switchToList() {
  fireEvent.click(screen.getByRole("button", { name: "List view" }));
}

describe("HomePage library list view", () => {
  it("renders EST date+time columns (Uploaded and File created)", async () => {
    renderHome();
    expect(await screen.findByText("Beta clip")).toBeTruthy();
    switchToList();

    expect(screen.getByText("Title")).toBeTruthy();
    expect(screen.getByText("File created (EST)")).toBeTruthy();
    expect(screen.getByText("Uploaded (EST)")).toBeTruthy();

    // v1's original file date renders as a date in Eastern time.
    expect(screen.getByText(/Jan 15, 2024/)).toBeTruthy();
    expect(screen.getAllByText(/EST/).length).toBeGreaterThan(0);
  });

  it("sorts rows when a column header is clicked", async () => {
    const { container } = renderHome();
    expect(await screen.findByText("Beta clip")).toBeTruthy();
    switchToList();

    const before = Array.from(container.querySelectorAll(".lib-title-text")).map(n => n.textContent);
    expect(before).toEqual(["Alpha clip", "Beta clip"]);

    fireEvent.click(screen.getByRole("button", { name: "Sort by Title" }));
    await waitFor(() => {
      const asc = Array.from(container.querySelectorAll(".lib-title-text")).map(n => n.textContent);
      expect(asc).toEqual(["Alpha clip", "Beta clip"]);
    });

    fireEvent.click(screen.getByRole("button", { name: "Sort by Title" }));
    await waitFor(() => {
      const desc = Array.from(container.querySelectorAll(".lib-title-text")).map(n => n.textContent);
      expect(desc).toEqual(["Beta clip", "Alpha clip"]);
    });
  });

  it("filters by the global search box", async () => {
    renderHome();
    expect(await screen.findByText("Beta clip")).toBeTruthy();
    switchToList();

    fireEvent.change(screen.getByRole("searchbox", { name: /search library/i }), {
      target: { value: "Alpha" },
    });
    await waitFor(() => expect(screen.queryByText("Beta clip")).toBeNull());
    expect(screen.getByText("Alpha clip")).toBeTruthy();
  });

  it("supports per-column filtering and clear-all", async () => {
    renderHome();
    expect(await screen.findByText("Beta clip")).toBeTruthy();
    switchToList();

    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    const titleFilter = screen.getByRole("textbox", { name: "Filter by Title" });
    fireEvent.change(titleFilter, { target: { value: "Beta" } });

    await waitFor(() => expect(screen.queryByText("Alpha clip")).toBeNull());
    expect(screen.getByText("Beta clip")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /clear all filters/i }));
    await waitFor(() => expect(screen.getByText("Alpha clip")).toBeTruthy());
  });

  it("hides a column via the Columns menu", async () => {
    renderHome();
    expect(await screen.findByText("Beta clip")).toBeTruthy();
    switchToList();

    expect(screen.getByRole("button", { name: "Sort by Duration" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /columns/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Duration" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Sort by Duration" })).toBeNull();
    });
  });

  it("edits a per-row note", async () => {
    renderHome();
    expect(await screen.findByText("Beta clip")).toBeTruthy();
    switchToList();

    const noteInput = screen.getByRole("textbox", { name: "Note for Beta clip" });
    fireEvent.change(noteInput, { target: { value: "follow up" } });
    expect((noteInput as HTMLInputElement).value).toBe("follow up");
  });
});
