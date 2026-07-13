import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Academic Ledger palette (semantic, driven by CSS vars for light/dark).
        ink: "rgb(var(--ink) / <alpha-value>)",
        parchment: "rgb(var(--parchment) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
        rule: "rgb(var(--rule) / <alpha-value>)",
        brass: "rgb(var(--brass) / <alpha-value>)",
        content: "rgb(var(--content) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        good: "rgb(var(--good) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
      },
      fontFamily: {
        serif: ["var(--font-fraunces)", "Georgia", "serif"],
        sans: ["var(--font-public-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "6px",
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fade: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "modal-pop": {
          "0%": { opacity: "0", transform: "translateY(12px) scale(0.97)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        rise: "rise 0.4s ease both",
        fade: "fade 0.25s ease both",
        "modal-pop": "modal-pop 0.28s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};

export default config;
