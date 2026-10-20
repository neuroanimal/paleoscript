/**
 * Statyczne wejście dla GitHub Pages: sam Scriptorium, bez TanStack Start, SSR, Nitro ani
 * logowania. Aplikacja deweloperska (npm run dev) zostaje bez zmian - to tylko drugi,
 * prosty punkt wejścia do tego samego komponentu. Build: npm run build:pages -> dist-pages/.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Scriptorium } from "@/components/scriptorium";
import "../src/styles.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Scriptorium />
    </StrictMode>,
  );
}
