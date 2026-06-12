/**
 * Name normalization, three levels:
 *  - K0: raw (trim + NFC). K0 equality = perfect match.
 *  - K1: cosmetic (typography, case, whitespace). K1 hit with K0 diff = trivially fixable.
 *    Accents are KEPT at K1: "Foret" vs "Forêt" is a real error, not cosmetic.
 *  - K2: expanded (accent folding, hyphen<->space, abbreviation expansion).
 *    K2 hit with K1 diff = real difference with an obvious official suggestion.
 */

export function k0(name: string): string {
  return name.normalize("NFC").trim();
}

const APOSTROPHES = /[’ʼ´`]/g; // ’ ʼ ´ `
const DASHES = /[–—−]/g; // – — −

export function k1(name: string): string {
  let s = k0(name);
  s = s.replace(APOSTROPHES, "'");
  s = s.replace(DASHES, "-");
  s = s.replace(/\s+/g, " ");
  s = s.replace(/\s*-\s*/g, "-");
  s = s.toLowerCase();
  s = s.replace(/ß/g, "ss");
  return s.trim();
}

export function foldAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
}

export interface AbbreviationRule {
  /** Lowercase token form, without trailing period. */
  abbrev: string;
  /** Possible full forms; several entries when ambiguous across languages. */
  expansions: string[];
  /** Only expand when the abbreviation is the first token of the name. */
  firstTokenOnly?: boolean;
}

/**
 * Community-extensible abbreviation table. Word-boundary anchored (whole tokens).
 * Deliberately NOT expanded: bare "r." (rue? route? too ambiguous).
 */
export const ABBREVIATIONS: AbbreviationRule[] = [
  { abbrev: "av", expansions: ["avenue"], firstTokenOnly: true },
  { abbrev: "bd", expansions: ["boulevard"] },
  { abbrev: "bvd", expansions: ["boulevard"] },
  { abbrev: "boul", expansions: ["boulevard"] },
  { abbrev: "ch", expansions: ["chemin"], firstTokenOnly: true },
  { abbrev: "rte", expansions: ["route"] },
  { abbrev: "pl", expansions: ["place", "platz", "piazza"] },
  { abbrev: "imp", expansions: ["impasse"] },
  { abbrev: "prom", expansions: ["promenade"] },
  { abbrev: "pass", expansions: ["passage"] },
  { abbrev: "fbg", expansions: ["faubourg"] },
  { abbrev: "fg", expansions: ["faubourg"] },
  { abbrev: "st", expansions: ["saint", "sankt"] },
  { abbrev: "ste", expansions: ["sainte"] },
  { abbrev: "str", expansions: ["strasse"] },
];

const ABBREV_MAP = new Map(ABBREVIATIONS.map((r) => [r.abbrev, r]));

/** Cap on variant combinations (e.g. several multi-expansion tokens in one name). */
const MAX_VARIANTS = 8;

/**
 * French/Italian function words whose presence often differs between Waze and
 * the register ("Chemin de Montaz" vs "Chemin de la Montaz"). German articles
 * are deliberately NOT stripped: they are integral to names like "Im Grund".
 */
const ARTICLES = new Set([
  "de", "du", "des", "la", "le", "les",
  "di", "da", "del", "della", "delle", "dei", "degli", "al", "alla", "ai",
]);

/** Article-stripped form of a K2 key; null when stripping would leave < 2 tokens. */
export function stripArticles(key: string): string | null {
  const tokens = key
    .split(" ")
    .filter((token) => !ARTICLES.has(token))
    .map((token) => token.replace(/^[ld]'/, ""));
  if (tokens.length < 2) return null;
  const stripped = tokens.join(" ");
  return stripped === key ? null : stripped;
}

/**
 * Expanded keys. Returns every plausible canonical form (multi-language
 * abbreviations like "pl." or "st." produce several variants).
 */
export function k2(name: string): string[] {
  let s = k1(name);
  s = foldAccents(s);
  // German glued suffix: "bahnhofstr." / "bahnhofstr" -> "bahnhofstrasse".
  // Lookahead keeps "bahnhofstrasse" itself untouched.
  s = s.replace(/(\p{L}{2,})str\.?(?=$|\s|-)/gu, "$1strasse");
  s = s.replace(/-/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  const tokens = s.split(" ").filter((t) => t.length > 0);
  let variants: string[][] = [[]];
  tokens.forEach((token, i) => {
    const bare = token.replace(/\./g, "");
    const rule = ABBREV_MAP.get(bare);
    const options = rule && (!rule.firstTokenOnly || i === 0) ? rule.expansions : [bare];
    variants = variants
      .flatMap((v) => options.map((option) => [...v, option]))
      .slice(0, MAX_VARIANTS);
  });
  const keys = [...new Set(variants.map((v) => v.join(" ")))];
  // Article-insensitive variants come LAST so stricter keys win in the cascade.
  for (const key of [...keys]) {
    const stripped = stripArticles(key);
    if (stripped && !keys.includes(stripped)) keys.push(stripped);
  }
  return keys;
}
