/**
 * Next 16 + Tailwind v4 build boundary. Next's own CSS pipeline runs PostCSS, so
 * Tailwind v4 is wired through its PostCSS plugin (not the Vite plugin the React
 * example uses). The single `@tailwindcss/postcss` entry is the documented Next
 * App Router setup; the kit tokens load via `@import "tailwindcss"` in
 * `app/globals.css`.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
