import { normalizeOfflineLocale, OFFLINE_LANGUAGE_STORAGE_KEY } from "#app/offline-locale";
import { describe, expect, it } from "vitest";

describe("offline locale isolation", () => {
  it("uses a build-specific storage key", () => {
    expect(OFFLINE_LANGUAGE_STORAGE_KEY).toBe("pokerogueOfflineLang");
    expect(OFFLINE_LANGUAGE_STORAGE_KEY).not.toBe("prLang");
  });

  it.each(["zh-TW", "zh_HK", "zh-MO", "zh-Hant", "zh-Hant-TW"])("maps %s to Traditional Chinese", language => {
    expect(normalizeOfflineLocale(language)).toBe("zh-Hant");
  });

  it.each(["zh-CN", "zh_SG", "zh-Hans", "zh-Hans-CN"])("maps %s to Simplified Chinese", language => {
    expect(normalizeOfflineLocale(language)).toBe("zh-Hans");
  });

  it("preserves unrelated supported languages", () => {
    expect(normalizeOfflineLocale("th")).toBe("th");
    expect(normalizeOfflineLocale("en-US")).toBe("en-US");
  });
});
