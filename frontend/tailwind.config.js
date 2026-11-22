/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        forest: {
          950: "#060907", // Deepest abyss charcoal
          900: "#0a0f0d", // Dark background
          850: "#0f1713", // Primary card background
          800: "#141f1a", // Secondary container
          750: "#1b2822", // Border / hover surface
          700: "#22332c", // Subtle lines & muted text borders
          600: "#2e463c", // Accent dark
          500: "#3d5e51", // Muted sage
          400: "#4f7b6a", // Sage highlight
          300: "#6fa18d", // Light moss
          200: "#9ec2b3",
          100: "#cfe3db",
          50: "#edf5f2",
        },
        bio: {
          emerald: "#10b981",
          leaf: "#34d399",
          moss: "#059669",
          pine: "#065f46",
          amber: "#f59e0b",
          coral: "#f43f5e",
          cyan: "#06b6d4",
          violet: "#8b5cf6",
        },
      },
      fontFamily: {
        mono: [
          "JetBrains Mono",
          "Fira Code",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      boxShadow: {
        'forest-glow': '0 0 25px -5px rgba(16, 185, 129, 0.15)',
        'card-glow': '0 4px 20px -2px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(52, 211, 153, 0.08)',
      },
    },
  },
  plugins: [],
}
