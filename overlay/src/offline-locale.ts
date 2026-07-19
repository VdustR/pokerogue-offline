import { supportedLngs } from "#app/i18n-supported-lngs";

export const OFFLINE_LANGUAGE_STORAGE_KEY = "pokerogueOfflineLang";

type SupportedOfflineLocale = (typeof supportedLngs)[number];

const supportedLocaleByLowercase = new Map(supportedLngs.map(locale => [locale.toLowerCase(), locale]));
const LATIN_AMERICAN_SPANISH_REGIONS = new Set([
  "AR",
  "BO",
  "BZ",
  "CL",
  "CO",
  "CR",
  "CU",
  "DO",
  "EC",
  "GT",
  "HN",
  "MX",
  "NI",
  "PA",
  "PE",
  "PR",
  "PY",
  "SV",
  "US",
  "UY",
  "VE",
]);
const SIMPLIFIED_CHINESE_REGIONS = new Set(["CN", "MY", "SG"]);
const TRADITIONAL_CHINESE_REGIONS = new Set(["HK", "MO", "TW"]);

// This valid private-use tag lets i18next continue to the next navigator.languages
// candidate. If none match, i18next applies its configured English fallback.
const UNSUPPORTED_LOCALE = "x-pokerogue-unsupported";

function canonicalizeLocale(language: string): string | undefined {
  const normalized = language.trim().replaceAll("_", "-");
  if (!normalized) {
    return;
  }

  if (typeof Intl !== "undefined" && typeof Intl.getCanonicalLocales === "function") {
    try {
      return Intl.getCanonicalLocales(normalized)[0];
    } catch {
      return;
    }
  }

  return normalized;
}

interface LocaleParts {
  languageCode: string;
  script: string | undefined;
  region: string | undefined;
}

function parseLocaleParts(language: string): LocaleParts {
  if (typeof Intl !== "undefined" && typeof Intl.Locale === "function") {
    try {
      const locale = new Intl.Locale(language);
      return {
        languageCode: locale.language.toLowerCase(),
        script: locale.script,
        region: locale.region,
      };
    } catch {
      // Fall through to the small BCP 47 parser for malformed or unsupported tags.
    }
  }

  const [languageCode = "", ...subtags] = language.split("-");
  let script: string | undefined;
  let region: string | undefined;
  for (const subtag of subtags) {
    if (subtag.length === 1) {
      break;
    }
    if (!script && /^[a-z]{4}$/i.test(subtag)) {
      script = `${subtag[0].toUpperCase()}${subtag.slice(1).toLowerCase()}`;
    } else if (!region && (/^[a-z]{2}$/i.test(subtag) || /^\d{3}$/.test(subtag))) {
      region = subtag.toUpperCase();
    }
  }

  return { languageCode: languageCode.toLowerCase(), script, region };
}

function resolveChineseLocale(
  script: string | undefined,
  region: string | undefined,
): SupportedOfflineLocale | undefined {
  if (script === "Hant" || (region && TRADITIONAL_CHINESE_REGIONS.has(region))) {
    return "zh-Hant";
  }
  if (script === "Hans" || (region && SIMPLIFIED_CHINESE_REGIONS.has(region))) {
    return "zh-Hans";
  }
}

function resolveSpanishLocale(region: string | undefined): SupportedOfflineLocale | undefined {
  if (region === "ES") {
    return "es-ES";
  }
  if (region === "419" || (region && LATIN_AMERICAN_SPANISH_REGIONS.has(region))) {
    return "es-419";
  }
}

/** Resolves one system locale to a language that this PokéRogue build actually ships. */
export function resolveOfflineLocale(language: string): SupportedOfflineLocale | undefined {
  const canonicalLocale = canonicalizeLocale(language);
  if (!canonicalLocale) {
    return;
  }

  const exactMatch = supportedLocaleByLowercase.get(canonicalLocale.toLowerCase());
  if (exactMatch) {
    return exactMatch;
  }

  const { languageCode, script, region } = parseLocaleParts(canonicalLocale);

  if (languageCode === "zh") {
    return resolveChineseLocale(script, region);
  }

  if (languageCode === "es") {
    return resolveSpanishLocale(region);
  }

  // Modern operating systems normally report Filipino as `fil`, while the
  // upstream translation is still published under its legacy `tl` code.
  if (languageCode === "fil") {
    return supportedLocaleByLowercase.get("tl");
  }

  // Region variants are safe only when upstream ships a language-wide locale,
  // for example de-AT -> de. Regional-only translations such as pt-BR remain exact-only.
  return supportedLocaleByLowercase.get(languageCode);
}

/** Converts each detector candidate without allowing i18next's loose prefix matching. */
export function normalizeOfflineLocale(language: string): string {
  return resolveOfflineLocale(language) ?? UNSUPPORTED_LOCALE;
}
