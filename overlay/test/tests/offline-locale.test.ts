import { supportedLngs } from "#app/i18n-supported-lngs";
import { normalizeOfflineLocale, OFFLINE_LANGUAGE_STORAGE_KEY, resolveOfflineLocale } from "#app/offline-locale";
import { createInstance } from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  localStorage.removeItem(OFFLINE_LANGUAGE_STORAGE_KEY);
});

async function detectSystemLanguages(languages: string[]): Promise<string> {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
  vi.spyOn(navigator, "language", "get").mockReturnValue(languages[0] ?? "");

  const i18n = createInstance();
  await i18n.use(LanguageDetector).init({
    fallbackLng: "en",
    supportedLngs,
    detection: {
      lookupLocalStorage: OFFLINE_LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
      order: ["localStorage", "navigator"],
      convertDetectedLanguage: normalizeOfflineLocale,
    },
  });
  return i18n.language;
}

describe("offline locale isolation", () => {
  it("uses a build-specific storage key", () => {
    expect(OFFLINE_LANGUAGE_STORAGE_KEY).toBe("pokerogueOfflineLang");
    expect(OFFLINE_LANGUAGE_STORAGE_KEY).not.toBe("prLang");
  });

  it.each(["zh-TW", "zh_HK", "zh-MO", "zh-Hant", "zh-Hant-TW"])("maps %s to Traditional Chinese", language => {
    expect(resolveOfflineLocale(language)).toBe("zh-Hant");
  });

  it.each(["zh-CN", "zh_SG", "zh-MY", "zh-Hans", "zh-Hans-CN"])("maps %s to Simplified Chinese", language => {
    expect(resolveOfflineLocale(language)).toBe("zh-Hans");
  });

  it.each([
    ["en-US", "en"],
    ["de-AT", "de"],
    ["ja-JP", "ja"],
    ["ko-KR", "ko"],
    ["fil-PH", "tl"],
    ["th-TH", "th"],
    ["pt-BR", "pt-BR"],
  ])("maps the system locale %s to the supported language %s", (language, expected) => {
    expect(resolveOfflineLocale(language)).toBe(expected);
  });

  it.each([
    ["es-ES", "es-ES"],
    ["es-MX", "es-419"],
    ["es-AR", "es-419"],
    ["es-US", "es-419"],
  ])("disambiguates Spanish locale %s as %s", (language, expected) => {
    expect(resolveOfflineLocale(language)).toBe(expected);
  });

  it.each([
    "zh",
    "es",
    "pt-PT",
    "nn-NO",
    "not_a_locale",
    "",
  ])("does not guess an unsupported or ambiguous locale: %s", language => {
    expect(resolveOfflineLocale(language)).toBeUndefined();
  });

  it("keeps an unsupported first preference from hiding a supported later preference", () => {
    expect(normalizeOfflineLocale("pt-PT")).toBe("x-pokerogue-unsupported");
    expect(normalizeOfflineLocale("ja-JP")).toBe("ja");
  });

  it("tries later system preferences and caches the first supported match", async () => {
    expect(await detectSystemLanguages(["pt-PT", "ja-JP"])).toBe("ja");
    expect(localStorage.getItem(OFFLINE_LANGUAGE_STORAGE_KEY)).toBe("ja");
  });

  it("falls back to English when no system preference is supported", async () => {
    expect(await detectSystemLanguages(["pt-PT", "nn-NO"])).toBe("en");
    expect(localStorage.getItem(OFFLINE_LANGUAGE_STORAGE_KEY)).toBe("en");
  });

  it("preserves a previously stored player choice over system preferences", async () => {
    localStorage.setItem(OFFLINE_LANGUAGE_STORAGE_KEY, "th");
    expect(await detectSystemLanguages(["ja-JP"])).toBe("th");
    expect(localStorage.getItem(OFFLINE_LANGUAGE_STORAGE_KEY)).toBe("th");
  });
});
