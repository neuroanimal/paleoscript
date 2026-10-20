/**
 * Build statyczny na GitHub Pages (https://<użytkownik>.github.io/paleoscript/).
 *
 * Osobny od vite.config.ts, bo tamten wpina TanStack Start i Nitro (SSR, preset Vercel),
 * a Pages serwuje wyłącznie pliki. Scriptorium działa całkowicie w przeglądarce, więc
 * wystarcza zwykły React + Tailwind. Ścieżkę bazową można nadpisać: PAGES_BASE=/ npm run build:pages
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  root: "pages",
  base: process.env.PAGES_BASE ?? "/paleoscript/",
  publicDir: false,
  resolve: { alias: { "@": src } },
  plugins: [tailwindcss(), viteReact()],
  build: {
    outDir: "../dist-pages",
    emptyOutDir: true,
  },
});
