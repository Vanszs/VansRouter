"use client";

import { useEffect } from "react";

// Injects the Material Symbols Outlined stylesheet at runtime.
// Next.js 16 strips external <link rel="stylesheet"> tags from the <head>
// in Server Components, so we render it from a Client Component via useEffect.
//
// If you add a new icon name in JSX, append it to the icon_names list below
// (alphabetically sorted — Google Fonts returns 400 otherwise) and rebuild.
const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined&display=swap";

export default function MaterialSymbolsLink() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    let link = document.querySelector('link[data-material-symbols]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "stylesheet";
      link.dataset.materialSymbols = "true";
      link.href = FONT_HREF;
      document.head.appendChild(link);
    }
  }, []);
  return null;
}
