/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Satoshi", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        surface: {
          DEFAULT: "hsl(var(--surface))",
          raised: "hsl(var(--surface-raised))",
          hover: "hsl(var(--surface-hover))",
        },
        clean: {
          blue: "hsl(var(--clean-blue))",
          green: "hsl(var(--clean-green))",
          yellow: "hsl(var(--clean-yellow))",
          red: "hsl(var(--clean-red))",
          cyan: "hsl(var(--clean-cyan))",
          purple: "hsl(var(--clean-purple))",
        },
        iqon: {
          bg: "hsl(var(--background))",
          card: "hsl(var(--card))",
          row: "hsl(var(--iqon-row))",
          border: "hsl(var(--border))",
          borderSoft: "hsl(var(--iqon-border-soft))",
          green: "hsl(var(--clean-green))",
          cyan: "hsl(var(--clean-cyan))",
          purple: "hsl(var(--clean-purple))",
          red: "hsl(var(--clean-red))",
          yellow: "hsl(var(--clean-yellow))",
          muted: "hsl(var(--muted-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 8px)",
        "3xl": "calc(var(--radius) + 16px)",
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
        clean: "var(--shadow-clean)",
        blue: "var(--shadow-blue)",
      },
      spacing: {
        page: "2rem",
      },
    },
  },
  plugins: [],
}
