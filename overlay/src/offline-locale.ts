export const OFFLINE_LANGUAGE_STORAGE_KEY = "pokerogueOfflineLang";

/** Normalizes browser locale tags that i18next cannot safely disambiguate by prefix alone. */
export function normalizeOfflineLocale(language: string): string {
  const normalized = language.replaceAll("_", "-");
  const lowerLanguage = normalized.toLowerCase();

  if (/^zh-(hant|tw|hk|mo)(?:-|$)/.test(lowerLanguage)) {
    return "zh-Hant";
  }
  if (/^zh-(hans|cn|sg)(?:-|$)/.test(lowerLanguage)) {
    return "zh-Hans";
  }

  return normalized;
}
