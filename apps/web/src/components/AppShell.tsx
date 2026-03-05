import { Link, NavLink } from "react-router-dom";
import { useEffect, useMemo, useState, type PropsWithChildren } from "react";

export function AppShell({ children }: PropsWithChildren) {
  const storedTheme = useMemo<"light" | "dark" | null>(() => {
    if (typeof window === "undefined") return "light";
    const stored = window.localStorage.getItem("cap-theme");
    return stored === "light" || stored === "dark" ? stored : null;
  }, []);
  const initialTheme = useMemo<"light" | "dark">(() => {
    if (storedTheme) return storedTheme;
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }, [storedTheme]);
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);
  const [hasUserOverride, setHasUserOverride] = useState(Boolean(storedTheme));

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("theme-dark", theme === "dark");
    root.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    if (hasUserOverride || typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => setTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", syncTheme);
    return () => media.removeEventListener("change", syncTheme);
  }, [hasUserOverride]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="mx-auto flex w-full max-w-[1320px] items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            Cap
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <NavLink
              to="/"
              className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`}
            >
              Home
            </NavLink>
            <NavLink
              to="/record"
              className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`}
            >
              Record
            </NavLink>
            <button
              type="button"
              onClick={() => {
                const nextTheme = theme === "light" ? "dark" : "light";
                setTheme(nextTheme);
                setHasUserOverride(true);
                window.localStorage.setItem("cap-theme", nextTheme);
              }}
              className="icon-toggle"
              aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
              title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            >
              {theme === "light" ? (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                </svg>
              )}
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1320px] px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
