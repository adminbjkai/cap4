export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hrs > 0) return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / 1024 ** exp;
  return `${val.toFixed(val >= 10 ? 0 : 1)} ${units[exp]}`;
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "--";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  return `${mins}m ${secs}s`;
}

export function buildPublicObjectUrl(key: string): string {
  const endpoint = (import.meta.env.VITE_S3_PUBLIC_ENDPOINT as string | undefined);
  const bucket = (import.meta.env.VITE_S3_BUCKET as string | undefined) ?? "cap4";
  
  let base: string;
  if (endpoint) {
    // Use configured endpoint (works for both production and localhost with CORS/proxy)
    base = `${endpoint.replace(/\/$/, "")}/${bucket}`;
  } else {
    // Fallback to relative path for same-origin proxying
    base = `/${bucket}`;
  }
  
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${base}/${encodedKey}`;
}
