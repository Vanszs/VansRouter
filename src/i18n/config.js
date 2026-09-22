export const LOCALES = ["en", "vi", "zh-CN", "zh-TW", "ja", "pt-BR", "pt-PT", "ko", "es", "de", "fr", "he", "ar", "ru", "pl", "cs", "nl", "tr", "uk", "tl", "id", "th", "hi", "bn", "ur", "fa", "ro", "sv", "it", "el", "hu", "fi", "da", "no"];
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "locale";

export function normalizeLocale(locale) {
  if (locale === "zh") {
    return "zh-CN";
  }
  return LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
}

export function isSupportedLocale(locale) {
  return LOCALES.includes(locale);
}
