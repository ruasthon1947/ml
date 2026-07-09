/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        schibsted: ["Schibsted Grotesk", "sans-serif"],
        inter: ["Inter", "sans-serif"],
        fustat: ["Fustat", "sans-serif"],
        noto: ["Noto Sans", "sans-serif"],
      },
      colors: {
        ink: "#0b0f14",
        shell: "#0f141b",
        panel: "#141a23",
        line: "#1f2733",
        muted: "#8a95a5",
        brand: "#3b6ef5",
        sage: "#5db075",
        amber: "#d8a14a",
        rose: "#d96a6a",
        steel: "#5c87b8",
        // government-friendly status palette
        statusOpen: "#5c87b8",
        statusInvestigation: "#d8a14a",
        statusChargesheeted: "#5db075",
        statusClosed: "#7d8898",
        statusFalse: "#9aa3b3",
        // light-mode tokens (used by .light scope)
        lbg: "#f5f7fb",
        lcard: "#ffffff",
        ltext: "#0b0f14",
        lmuted: "#5a6678",
        lline: "#e3e8f0",
        lpanel: "#fafbfd",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.06)",
        glow: "0 0 0 1px rgba(59,110,245,0.25), 0 12px 36px rgba(59,110,245,0.18)",
      },
    },
  },
  plugins: [],
};
