/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // Dark mode via .theme-dark class on <html>
  darkMode: ["class", "[class~='theme-dark']"],
  theme: {
    extend: {
      colors: {
        // ── Semantic surface tokens (CSS-var backed) ──────────────────
        // These make bg-surface, text-foreground, etc. actual Tailwind utilities.
        foreground:       "var(--text-primary)",
        secondary:        "var(--text-secondary)",
        muted:            "var(--text-muted)",
        primary:          "var(--accent)",
        surface:          "var(--bg-surface)",
        "surface-subtle": "var(--bg-surface-subtle)",
        "surface-muted":  "var(--bg-surface-muted)",
        elevated:         "var(--bg-elevated)",
        app:              "var(--bg-app)",
        // ── Border tokens ─────────────────────────────────────────────
        "border-default": "var(--border-default)",
        "border-strong":  "var(--border-strong)",
        // ── Interactive states ─────────────────────────────────────────
        hover:            "var(--hover-surface)",
        // ── Blue accent (tabs, focus rings, active markers) ────────────
        blue: {
          DEFAULT: "var(--accent-blue)",
          hover:   "var(--accent-blue-hover)",
          subtle:  "var(--accent-blue-subtle)",
          border:  "var(--accent-blue-border)",
          muted:   "var(--accent-blue-muted)",
        },
        // ── Primary accent (sage green) ─────────────────────────────────
        // Available palette entries kept for design-system consistency.
        // Currently used in app code: accent-700 only.
        // Currently unused in app code: accent-50, accent-100, accent-200, accent-500, accent-600.
        accent: {
          50:  "#f0f5f1",
          100: "#dce8dd",
          200: "#b8d4bc",
          500: "#6b8f71",
          600: "#5a7d60",
          700: "#4a6a50",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        soft:     "0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.1)",
        card:     "0 2px 8px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)",
        elevated: "0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06)",
        tooltip:  "0 4px 16px rgba(0, 0, 0, 0.14), 0 1px 4px rgba(0, 0, 0, 0.08)",
        "accent-glow": "0 0 0 3px color-mix(in srgb, var(--accent-blue) 28%, transparent), 0 0 24px color-mix(in srgb, var(--accent-blue) 30%, transparent)",
      },
      backgroundImage: {
        "accent-gradient": "var(--accent-blue-gradient)",
        "accent-gradient-soft": "var(--accent-blue-gradient-soft)",
        "status-success-gradient": "var(--status-success-gradient)",
        "status-warning-gradient": "var(--status-warning-gradient)",
        "status-danger-gradient": "var(--status-danger-gradient)",
        "status-info-gradient": "var(--status-info-gradient)",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.22, 1, 0.36, 1)",
        smooth: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      transitionDuration: {
        260: "260ms",
      },
    },
  },
  plugins: [],
};
