/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx,js,jsx}"
  ],
  theme: {
    extend: {
      colors: {
        // Intelligence workspace design tokens.
        // Chrome accent is amber (trading-terminal heritage); semantic
        // green/red are reserved strictly for P/L and grades and must never
        // double as the accent. See docs/design/intelligence-design-system.md.
        intel: {
          // ── Elevation ladder ────────────────────────────────────────────
          // Structure is carried by SURFACE luminance, not borders. Ground →
          // surface → raised → active. Panels are separated by whitespace and
          // a faint elevation step, so the eye reads information before edges.
          bg: "#04070e",        // ground — the continuous workspace
          panel: "#0a111c",     // surface — a subtle step above ground
          panel2: "#111b29",    // raised — hover / secondary surface
          raised: "#172231",    // active — selected row / pressed
          // ── Dividers (rare + charcoal) ──────────────────────────────────
          // `line` is now a soft charcoal that recedes; use sparingly. Borders
          // are the exception, not the default. `divider` is the hairline for
          // grouping inside a borderless surface.
          line: "#16202e",      // subtle edge (was a visible slate outline)
          lineSoft: "#0f1825",  // faintest divider
          divider: "#131d2a",   // hairline inside a flat surface
          // ── Ink ramp ────────────────────────────────────────────────────
          ink: "#eef2fa",       // primary — prices, large numbers
          ink2: "#93a3ba",      // secondary — metadata
          ink3: "#5c6b81",      // muted — labels, units
          // ── Chrome accent (amber) ───────────────────────────────────────
          accent: "#f5a623",
          accentSoft: "rgba(245,166,35,0.12)",
          accentLine: "rgba(245,166,35,0.38)",
          // ── Semantic channels — each hue means one thing ────────────────
          pos: "#35d29a",       // positive · long · bid-side up
          neg: "#f87171",       // negative · short · risk
          warn: "#fbbf24",      // caution · pending · stale
          info: "#6aa5f5",      // selection · active · blue
          cyan: "#34c9df",      // streaming · live tape
          ai: "#a98bf5",        // AI · intelligence (purple, never chrome)
          aiSoft: "rgba(169,139,245,0.12)",
          aiLine: "rgba(169,139,245,0.40)",
        },
      },
      fontFamily: {
        // Monospace carries every number, id, label, and metric (tabular-nums).
        // System stack — CSP-safe, and the terminal idiom needs no webfont.
        mono: [
          "ui-monospace", "SFMono-Regular", "SF Mono", "JetBrains Mono",
          "Menlo", "Consolas", "monospace",
        ],
      },
      letterSpacing: {
        label: "0.16em",
        eyebrow: "0.22em",
      },
      borderRadius: {
        // Tighter than a marketing card — a terminal surface, not a bubble.
        panel: "7px",
      },
      keyframes: {
        // Live-status pulses. Gated behind motion-reduce: in components.
        heartbeat: {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.45", transform: "scale(0.82)" },
        },
        livering: {
          "0%": { boxShadow: "0 0 0 0 rgba(53,210,154,0.5)" },
          "70%": { boxShadow: "0 0 0 6px rgba(53,210,154,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(53,210,154,0)" },
        },
        // Price-tick flashes: a brief tint on the value cell when it updates,
        // green for an uptick and red for a downtick, then fade. Functional
        // motion only — gated behind motion-reduce at the call site.
        flashUp: {
          "0%": { backgroundColor: "rgba(53,210,154,0.28)" },
          "100%": { backgroundColor: "transparent" },
        },
        flashDown: {
          "0%": { backgroundColor: "rgba(248,113,113,0.28)" },
          "100%": { backgroundColor: "transparent" },
        },
      },
      animation: {
        heartbeat: "heartbeat 1.8s ease-in-out infinite",
        livering: "livering 2s ease-out infinite",
        "flash-up": "flashUp 0.5s ease-out",
        "flash-down": "flashDown 0.5s ease-out",
      },
    },
  },
  plugins: [],
}
