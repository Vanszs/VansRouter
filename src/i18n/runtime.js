"use client";

import { DEFAULT_LOCALE, LOCALE_COOKIE, normalizeLocale } from "./config";

let translationMap = {};
let currentLocale = DEFAULT_LOCALE;
let reloadCallbacks = [];
let observer = null;
let initializedLocale = null;
let initPromise = null;

// Read locale from cookie
function getLocaleFromCookie() {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : DEFAULT_LOCALE;
  return normalizeLocale(value);
}

// Load translation map
async function loadTranslations(locale) {
  if (locale === "en") {
    translationMap = {};
    return;
  }

  try {
    const response = await fetch(`/i18n/literals/${locale}.json`);
    translationMap = await response.json();
  } catch (err) {
    console.error("Failed to load translations:", err);
    translationMap = {};
  }
}

// Translate text - exported for use in components
export function translate(text) {
  if (!text || typeof text !== "string") return text;
  const trimmed = text.trim();
  if (!trimmed) return text;
  if (currentLocale === "en") return text;
  return translationMap[trimmed] || text;
}

// Get current locale - exported for use in components
export function getCurrentLocale() {
  return currentLocale;
}

// Register callback for locale changes
export function onLocaleChange(callback) {
  reloadCallbacks.push(callback);
  return () => {
    reloadCallbacks = reloadCallbacks.filter(cb => cb !== callback);
  };
}

// Process text node
function processTextNode(node) {
  if (!node.nodeValue || !node.nodeValue.trim()) return;

  // Skip if parent is script, style, code, or structural elements
  const parent = node.parentElement;
  if (!parent) return;

  // Skip if parent or any ancestor has data-i18n-skip attribute
  let element = parent;
  while (element) {
    if (element.hasAttribute && element.hasAttribute('data-i18n-skip')) {
      return;
    }
    element = element.parentElement;
  }

  const tagName = parent.tagName?.toLowerCase();

  // Skip elements that don't allow text nodes or icon font ligature containers
  const skipTags = [
    "script", "style", "code", "pre",
    "colgroup", "table", "thead", "tbody", "tfoot", "tr",
    "select", "datalist", "optgroup"
  ];

  if (skipTags.includes(tagName)) return;

  // Never translate text nodes inside icon font containers (Material Symbols/Icons)
  // because icon ligature strings (e.g. "search", "close", "edit", "menu") will be
  // translated into foreign text (e.g. "بحث", "关闭", "Suchen"), breaking icon rendering.
  const classList = parent.classList;
  if (
    classList &&
    (classList.contains("material-symbols-outlined") ||
      classList.contains("material-symbols") ||
      classList.contains("material-icons") ||
      classList.contains("material-icons-outlined"))
  ) {
    return;
  }

  // Store original text if not already stored
  if (!node._originalText) {
    node._originalText = node.nodeValue;
  }

  // Use original text for translation
  const original = node._originalText;
  const translated = translate(original);

  // Only update if different to avoid unnecessary DOM mutations
  if (translated !== node.nodeValue) {
    node.nodeValue = translated;
  }
}

// Process all text nodes in element
function processElement(element) {
  if (!element) return;

  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  let node;
  const nodesToProcess = [];

  // Collect all nodes first to avoid live collection issues
  while ((node = walker.nextNode())) {
    nodesToProcess.push(node);
  }

  // Process collected nodes
  nodesToProcess.forEach(processTextNode);
}

function ensureObserver() {
  if (observer) return;
  observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          processElement(node);
        } else if (node.nodeType === Node.TEXT_NODE) {
          processTextNode(node);
        }
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// Initialize runtime i18n once per locale. English needs no DOM observer:
// the server already rendered the source text and there are no translations.
export function initRuntimeI18n() {
  if (typeof window === "undefined") return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    currentLocale = getLocaleFromCookie();
    initializedLocale = currentLocale;
    if (currentLocale === "en") return;

    await loadTranslations(currentLocale);
    processElement(document.body);
    ensureObserver();
  })().finally(() => {
    initPromise = null;
  });
  return initPromise;
}

// Reload only when the locale cookie actually changes. The observer handles
// newly inserted nodes, so route changes do not trigger a full DOM scan.
export async function reloadTranslations() {
  if (typeof window === "undefined") return;
  const nextLocale = getLocaleFromCookie();
  if (nextLocale === currentLocale && nextLocale === initializedLocale) return;

  currentLocale = nextLocale;
  initializedLocale = nextLocale;
  await loadTranslations(currentLocale);
  reloadCallbacks.forEach((callback) => callback());

  if (currentLocale === "en") {
    observer?.disconnect();
    observer = null;
  } else {
    ensureObserver();
  }
  processElement(document.body);
}
