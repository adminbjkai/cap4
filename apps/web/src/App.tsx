import { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { CommandPalette, type CommandPaletteAction } from "./components/CommandPalette";
import { ShortcutsOverlay } from "./components/ShortcutsOverlay";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { getLibraryVideos, type LibraryVideoCard } from "./lib/api";
import { HomePage } from "./pages/HomePage";
import { RecordPage } from "./pages/RecordPage";
import { VideoPage } from "./pages/VideoPage";

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteVideos, setPaletteVideos] = useState<LibraryVideoCard[]>([]);

  useEffect(() => {
    if (!paletteOpen) return;
    void (async () => {
      try {
        const response = await getLibraryVideos({ limit: 100, sort: "created_desc" });
        setPaletteVideos(response.items);
      } catch {
        setPaletteVideos([]);
      }
    })();
  }, [paletteOpen]);

  const commandActions = useMemo<CommandPaletteAction[]>(() => {
    const baseActions: CommandPaletteAction[] = [
      {
        id: "go-home",
        title: "Go to Home",
        subtitle: "Open your video library",
        keywords: ["home", "library", "dashboard"],
        onSelect: () => navigate("/"),
      },
      {
        id: "go-record",
        title: "Go to Record",
        subtitle: "Start or upload a recording",
        keywords: ["record", "upload", "new"],
        onSelect: () => navigate("/record"),
      },
      {
        id: "upload",
        title: "Upload New Video",
        subtitle: "Open the record/upload page",
        keywords: ["upload", "new video", "import"],
        onSelect: () => navigate("/record"),
      },
      {
        id: "delete-current",
        title: "Delete Current Video",
        subtitle: "Open delete confirmation on the active video page",
        keywords: ["delete", "remove", "video"],
        onSelect: () => window.dispatchEvent(new CustomEvent("cap:request-delete-active-video")),
      },
    ];

    const videoActions = paletteVideos.slice(0, 40).map<CommandPaletteAction>((video) => ({
      id: `open-video-${video.videoId}`,
      title: video.displayTitle || "Untitled recording",
      subtitle: "Open video",
      keywords: ["video", "open", video.videoId],
      onSelect: () => navigate(`/video/${video.videoId}`),
    }));

    return [...baseActions, ...videoActions];
  }, [navigate, paletteVideos]);

  useKeyboardShortcuts({
    onToggleCommandPalette: () => {
      setPaletteOpen((open) => !open);
      setShortcutsOpen(false);
    },
    onToggleShortcutsOverlay: () => {
      setShortcutsOpen((open) => !open);
      setPaletteOpen(false);
    },
    onEscape: () => {
      if (paletteOpen) {
        setPaletteOpen(false);
        return;
      }
      if (shortcutsOpen) {
        setShortcutsOpen(false);
        return;
      }
      window.dispatchEvent(new CustomEvent("cap:escape"));
    },
    onGoHome: () => navigate("/"),
    onGoRecord: () => navigate("/record"),
  });

  useEffect(() => {
    setPaletteOpen(false);
    setShortcutsOpen(false);
  }, [location.pathname]);

  return (
    <AppShell
      overlays={
        <>
          <CommandPalette open={paletteOpen} actions={commandActions} onClose={() => setPaletteOpen(false)} />
          <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        </>
      }
    >
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/record" element={<RecordPage />} />
        <Route path="/video/:videoId" element={<VideoPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
