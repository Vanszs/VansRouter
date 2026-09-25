"use client";

import { useEffect } from "react";
import "./globals.css";

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen items-center justify-center bg-bg px-6 py-16 text-text-main">
          <section className="w-full max-w-lg rounded-lg border border-border bg-surface p-6 shadow-soft">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
              <span className="material-symbols-outlined text-[24px]">emergency_home</span>
            </div>
            <h1 className="text-xl font-semibold">VansAI could not load</h1>
            <p className="mt-2 text-sm leading-6 text-text-muted">
              A critical error stopped the app shell from rendering. Try loading it again.
            </p>
            {error?.message ? (
              <pre className="mt-4 max-h-36 overflow-auto rounded-md border border-border bg-surface-2 p-3 text-xs text-text-muted">
                {error.message}
              </pre>
            ) : null}
            <button
              type="button"
              onClick={reset}
              className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
            >
              <span className="material-symbols-outlined text-[18px]">refresh</span>
              Reload
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
