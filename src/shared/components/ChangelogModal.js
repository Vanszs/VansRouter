"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { marked } from "marked";
import { GITHUB_CONFIG } from "@/shared/constants/config";

marked.setOptions({ gfm: true, breaks: true });

function sanitizeHtml(html) {
  if (typeof window === "undefined") return "";
  const DOMPurify = require("dompurify");
  return DOMPurify.sanitize(html, { FORBID_TAGS: ["script", "iframe", "object", "embed", "form"], FORBID_ATTR: ["onerror", "onload", "onclick"] });
}

export default function ChangelogModal({ isOpen, onClose }) {
  const [fetchState, setFetchState] = useState({ html: "", loading: false, error: "" });
  const modalRef = useRef(null);
  const hasFetched = useRef(false);

  useEffect(() => {
    if (!isOpen || hasFetched.current) return;
    hasFetched.current = true;
    setFetchState(prev => ({ ...prev, loading: true, error: "" }));
    fetch(GITHUB_CONFIG.changelogUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((md) => setFetchState(prev => ({ ...prev, html: sanitizeHtml(marked.parse(md)), loading: false })))
      .catch((err) => setFetchState(prev => ({ ...prev, error: err.message || "Failed to load", loading: false })));
  }, [isOpen]);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) {
        onCloseRef.current();
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onEsc = (e) => { if (e.key === "Escape") onCloseRef.current(); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [isOpen]);

  if (!isOpen || typeof document === "undefined") return null;

  const { html, loading, error } = fetchState;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal content */}
      <div
        ref={modalRef}
        className="relative w-full bg-surface border border-black/10 dark:border-white/10 rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 max-w-3xl flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-black/5 dark:border-white/5">
          <h2 className="text-lg font-semibold text-text-main">Change Log</h2>
          <button type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {loading && (
            <div className="flex items-center justify-center py-10 text-text-muted">
              <span className="material-symbols-outlined animate-spin mr-2">progress_activity</span>
              Loading...
            </div>
          )}
          {error && (
            <div className="text-red-500 py-4">Failed to load changelog: {error}</div>
          )}
          {!loading && !error && html && (
            <div
              className="changelog-body text-text-main"
              // SECURITY: html is sanitized via DOMPurify.sanitize() before reaching this element
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

