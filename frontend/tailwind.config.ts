import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Warm Stone & Soft Neutral Palette inspired by Hermes Agent desktop UI
        canvas: "#E5E3DC",        // Main background
        sidebar: "#DDD9D1",       // Left navigation panel background
        card: "#EFECE5",          // Card / Container background
        cardHover: "#F6F4EE",     // Card hover background
        inputBg: "#E3E0D8",       // Search / Input bar background
        borderSubtle: "#D6D2C8",  // Clean warm border line
        borderFocus: "#BDB8AB",   // Focused border line
        
        // Text tones
        textPrimary: "#1C1B17",   // Primary headers and dark text
        textSecondary: "#6B6860", // Muted subtext
        textMuted: "#8E8A80",     // Muted labels/dates
        
        // Refined Accent Colors (Replacing blue with Sleek Obsidian & Warm Bronze)
        primaryDark: "#18181B",    // Active selection pill & primary button
        primaryDarkHover: "#27272A",
        accentBronze: "#B45309",   // Warm bronze highlight
        softBronzeBg: "#FEF3C7",
        softBronzeText: "#92400E",
        
        accentRose: "#DC2626",    // Debt / Warning red
        softRoseBg: "#FEE2E2",
        
        accentEmerald: "#16A34A", // Income / Paid green
        softEmeraldBg: "#DCFCE7",
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      boxShadow: {
        subtle: "0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)",
        card: "0 2px 8px rgba(0, 0, 0, 0.03), 0 1px 2px rgba(0, 0, 0, 0.02)",
        floating: "0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04)",
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      }
    },
  },
  plugins: [],
};

export default config;
