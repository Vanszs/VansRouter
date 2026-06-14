"use client";

import { useEffect } from "react";

export default function FontLoadDetector() {
  useEffect(() => {
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        document.documentElement.classList.add("fonts-loaded");
      });
    } else {
      document.documentElement.classList.add("fonts-loaded");
    }
  }, []);
  return null;
}
