/**
 * extract-fields.ts — pure, framework-free heuristics that turn raw OCR text
 * into candidate expense-report field values.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ WORKSHOP BLOCK 3 — Reading a document on-device                         │
 * │                                                                         │
 * │ OCR hands you a wall of noisy text. All the value is in what you do     │
 * │ with it. This is also where the privacy argument becomes visible: the   │
 * │ "0 bytes uploaded" counter sits right next to a scanned document.       │
 * │                                                                         │
 * │ Implement the functions marked TODO below.                              │
 * │   Check your work:  make verify-3                                       │
 * │   Stuck?            make solve-3                                        │
 * │                                                                         │
 * │ Watch it work:  http://localhost:4200/smartform?fixture=1               │
 * │ Hit "Scan document" — fields fill in as your extractors start working.  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * No Angular / DOM / Tesseract dependencies on purpose: every function is a
 * plain `string -> value` transform so the whole extraction pipeline is
 * trivially unit-testable without TestBed (see extract-fields.spec.ts). The
 * OcrService feeds this module its recognized text; the component patches the
 * form with the result. This is the demo's "proactive, never destructive"
 * brain — it only ever proposes values, each tagged with a confidence.
 *
 * Everything here also works with ZERO network and ZERO model: it is the
 * standalone heuristic path the CLAUDE spec requires. An optional on-device
 * Chrome Prompt API pass (see prompt-api.ts) can refine these results, but is
 * never required for the demo to function.
 */

/** How much we trust an extracted value — drives the on-screen badge colour. */
export type Confidence = 'high' | 'medium' | 'low';

/** The set of form fields we know how to extract, keyed as in the form model. */
export type FieldKey = 'date' | 'amount' | 'currency' | 'iban' | 'vendor' | 'email';

/** One proposed value plus how confident the heuristic is about it. */
export interface Extracted<T> {
  readonly value: T;
  readonly confidence: Confidence;
}

/**
 * The full extraction result. Every field is optional: a receipt that never
 * mentions an IBAN simply yields no `iban`. Values are already normalized to
 * the shape the form controls expect (ISO date string, numeric amount, ISO
 * 4217 currency code, space-free IBAN).
 */
export interface ExtractedFields {
  readonly date?: Extracted<string>;
  readonly amount?: Extracted<number>;
  readonly currency?: Extracted<string>;
  readonly iban?: Extracted<string>;
  readonly vendor?: Extracted<string>;
  readonly email?: Extracted<string>;
}

// =============================================================================
// IBAN
// =============================================================================

/**
 * TODO (block 3, core) — Validate an IBAN with the ISO 7064 mod-97-10 checksum
 * (used by ISO 13616).
 *
 * Why a checksum and not a regex: OCR misreads digits constantly, and a wrong
 * account number is far worse than an empty field. A checksum lets you REFUSE
 * to answer instead of guessing — which is why the extractor below only ever
 * fills the IBAN field with a value that passes this function.
 *
 * The algorithm:
 *   1. strip spaces, uppercase;
 *   2. reject anything that is not 2 letters, 2 check digits, then 1–30
 *      alphanumerics;
 *   3. move the first four characters to the end;
 *   4. map letters to numbers (A=10 … Z=35), concatenating them as digits;
 *   5. the resulting (very large) integer mod 97 must equal 1.
 *
 * Step 5 overflows a JS number, so fold the remainder as you go: keep a running
 * `remainder`, append each mapped value to it as text, and take `% 97` each
 * time. No BigInt needed.
 *
 * Pure and side-effect free — the single source of truth for "is this a real
 * IBAN", used by both extraction and the form's validator.
 */
export function isValidIban(candidate: string): boolean {
  return false;
}

/**
 * Fixed IBAN length per country code (ISO 13616 registry, common SEPA members).
 * Used to trim OCR text that ran the IBAN into the following word, without
 * accepting a shorter prefix that merely happens to pass the checksum.
 */
const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24,
  AT: 20,
  BE: 16,
  CH: 21,
  CZ: 24,
  DE: 22,
  DK: 18,
  EE: 20,
  ES: 24,
  FI: 18,
  FR: 27,
  GB: 22,
  GR: 27,
  IE: 22,
  IT: 27,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  NL: 18,
  NO: 15,
  PL: 28,
  PT: 25,
  RO: 24,
  SE: 24,
  SI: 19,
  SK: 24,
};

/**
 * Find the first checksum-valid IBAN in the text. OCR often splits an IBAN into
 * space-separated groups, so we scan runs of letters/digits/spaces and collapse
 * the spaces before validating. Only a value that passes {@link isValidIban} is
 * returned — we never fill the form with a plausible-but-wrong account number.
 * A valid checksum is strong evidence, hence always `high` confidence.
 */
export function extractIban(text: string): Extracted<string> | undefined {
  // Generous candidate region: country code + check digits, then a run of
  // alphanumerics and spaces (OCR breaks IBANs into groups of four).
  const re = /[A-Z]{2}\d{2}[A-Z0-9 ]{11,}/gi;
  for (const match of text.matchAll(re)) {
    const compact = match[0].replace(/\s+/g, '').toUpperCase();
    // The region may have absorbed a following word ("…013000 thanks"). Trim to
    // the country's fixed IBAN length before validating so we never accept a
    // shorter prefix that only coincidentally passes the mod-97 checksum.
    const expected = IBAN_LENGTHS[compact.slice(0, 2)];
    const candidate = expected ? compact.slice(0, expected) : compact;
    if (candidate.length >= 15 && isValidIban(candidate)) {
      return { value: candidate, confidence: 'high' };
    }
  }
  return undefined;
}

// =============================================================================
// Email
// =============================================================================

/**
 * Extract the first e-mail address. Deliberately conservative — a match on this
 * pattern is unambiguous, so confidence is always `high`. A trailing dot (from
 * "...@acme.com.") is trimmed so we do not capture sentence punctuation.
 */
export function extractEmail(text: string): Extracted<string> | undefined {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (!match) {
    return undefined;
  }
  return { value: match[0].replace(/\.+$/, '').toLowerCase(), confidence: 'high' };
}

// =============================================================================
// Amount + currency
// =============================================================================

/** Symbol / code → ISO 4217 code. Order matters: first match wins. */
const CURRENCIES: readonly { readonly re: RegExp; readonly code: string }[] = [
  { re: /€|\bEUR\b/i, code: 'EUR' },
  { re: /£|\bGBP\b/i, code: 'GBP' },
  { re: /\$|\bUSD\b/i, code: 'USD' },
  { re: /\bCHF\b/i, code: 'CHF' },
];

/** Words that mark the line carrying the receipt total, EN + DE. */
const TOTAL_KEYWORDS =
  /\b(total|amount\s*due|amount|balance|sum|grand\s*total|gesamt(?:betrag|summe)?|summe|betrag|zu\s*zahlen|rechnungsbetrag|endbetrag)\b/i;

/** Matches one money-like number, e.g. `1.234,56`, `1,234.56`, `42`, `12,50`. */
const MONEY_TOKEN = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/g;

/**
 * TODO (block 3, core) — Parse a single money token into a number, resolving the
 * thousands / decimal separator ambiguity between locales (`1.234,56` in
 * Germany vs `1,234.56` in the US — the same amount, mirrored punctuation).
 *
 * This is the unglamorous half of document AI, and it is where a naive
 * `parseFloat` quietly turns €1.234,56 into €1.23. The rules the specs expect:
 *
 *   - both separators present → the *last* one is the decimal separator;
 *   - a single separator followed by 1–2 digits → decimal (e.g. `12,50`);
 *   - otherwise every separator is a thousands separator (e.g. `1.234`).
 *
 * Strip any non-digit, non-separator characters first (currency symbols, stray
 * OCR marks). Return null when the token has no digits at all.
 */
export function parseMoney(raw: string): number | null {
  return null;
}

/** A money value found on a line, remembering whether it had a decimal part. */
interface MoneyHit {
  readonly value: number;
  readonly hasFraction: boolean;
}

/** Collect the money values on one line (integers included as fallbacks). */
function moneyOnLine(line: string): MoneyHit[] {
  const hits: MoneyHit[] = [];
  for (const m of line.matchAll(MONEY_TOKEN)) {
    const token = m[0];
    const value = parseMoney(token);
    if (value !== null) {
      hits.push({ value, hasFraction: /[.,]\d{1,2}$/.test(token) });
    }
  }
  return hits;
}

/** Pick the best money value on a line: prefer a decimal amount, else the max. */
function bestMoney(hits: readonly MoneyHit[]): number | undefined {
  const withFraction = hits.filter((h) => h.hasFraction);
  const pool = withFraction.length > 0 ? withFraction : hits;
  if (pool.length === 0) {
    return undefined;
  }
  return pool.reduce((max, h) => (h.value > max ? h.value : max), pool[0].value);
}

/** Detect the currency mentioned anywhere in the text, if any. */
export function extractCurrency(text: string): Extracted<string> | undefined {
  for (const { re, code } of CURRENCIES) {
    if (re.test(text)) {
      return { value: code, confidence: 'high' };
    }
  }
  return undefined;
}

/**
 * TODO (block 3, core) — Extract the receipt total.
 *
 * The trap: a receipt is full of numbers that look like money. `15.07.2026` is a
 * date, an IBAN is a wall of digits, and every line item has a price. Searching
 * the whole text for "the biggest number" finds the year.
 *
 * So restrict the search to lines that carry EVIDENCE of being the total — a
 * currency symbol/code, or a keyword like "total" / "Gesamtbetrag" (see
 * {@link TOTAL_KEYWORDS} and {@link CURRENCIES}, both given). Then:
 *
 *   - a line with a total keyword → `high` (prefer the LAST such line: on a
 *     receipt with both "subtotal" and "grand total", the later one is the one);
 *   - otherwise a line that mentions the currency → `high`;
 *   - otherwise return undefined. Filling nothing beats guessing wrong.
 *
 * The `moneyOnLine` and `bestMoney` helpers above are given — they prefer a
 * value with decimals over a bare integer, and otherwise take the largest.
 */
export function extractAmount(text: string): Extracted<number> | undefined {
  return undefined;
}

// =============================================================================
// Date
// =============================================================================

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  januar: 1,
  january: 1,
  feb: 2,
  februar: 2,
  february: 2,
  mar: 3,
  mär: 3,
  marz: 3,
  märz: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  mai: 5,
  jun: 6,
  juni: 6,
  june: 6,
  jul: 7,
  juli: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  okt: 10,
  october: 10,
  oktober: 10,
  nov: 11,
  november: 11,
  dec: 12,
  dez: 12,
  december: 12,
  dezember: 12,
};

/** Two-digit years map to the 2000s (receipts are contemporary). */
function fullYear(year: number): number {
  return year < 100 ? 2000 + year : year;
}

/** Format Y/M/D as an ISO `yyyy-mm-dd` string (the date input's value shape). */
function toIso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    return null;
  }
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

/**
 * Extract the first plausible date and normalize it to ISO `yyyy-mm-dd`.
 * Formats, in priority order:
 *
 *   - ISO `2026-07-15`                       → high
 *   - German dotted `15.07.2026` / `15.7.26` → high (day-first is unambiguous)
 *   - textual `15. Juli 2026` / `Jul 15, 2026` (DE + EN months) → medium
 *   - slashed `15/07/2026` (assumed day-first) → medium
 */
export function extractDate(text: string): Extracted<string> | undefined {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const value = toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (value) {
      return { value, confidence: 'high' };
    }
  }

  const dotted = text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/);
  if (dotted) {
    const value = toIso(fullYear(Number(dotted[3])), Number(dotted[2]), Number(dotted[1]));
    if (value) {
      return { value, confidence: 'high' };
    }
  }

  // Textual month, day-first (DE) or month-first (EN).
  const monthNames = Object.keys(MONTHS).join('|');
  const dmy = new RegExp(`\\b(\\d{1,2})\\.?\\s*(${monthNames})\\.?\\s+(\\d{2,4})\\b`, 'i');
  const mdy = new RegExp(`\\b(${monthNames})\\.?\\s+(\\d{1,2}),?\\s+(\\d{2,4})\\b`, 'i');
  const dm = text.match(dmy);
  if (dm) {
    const value = toIso(fullYear(Number(dm[3])), MONTHS[dm[2].toLowerCase()], Number(dm[1]));
    if (value) {
      return { value, confidence: 'medium' };
    }
  }
  const md = text.match(mdy);
  if (md) {
    const value = toIso(fullYear(Number(md[3])), MONTHS[md[1].toLowerCase()], Number(md[2]));
    if (value) {
      return { value, confidence: 'medium' };
    }
  }

  const slashed = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (slashed) {
    const value = toIso(fullYear(Number(slashed[3])), Number(slashed[2]), Number(slashed[1]));
    if (value) {
      return { value, confidence: 'medium' };
    }
  }

  return undefined;
}

// =============================================================================
// Vendor
// =============================================================================

/** Lines that are clearly not a vendor name (document headers, EN + DE). */
const NON_VENDOR = /^(rechnung|invoice|receipt|quittung|beleg|kassenbon|bill)\b/i;

/**
 * Guess the vendor from the top of the receipt — the weakest heuristic, hence
 * `low`/`medium` confidence. We take the first of the top few lines that reads
 * like a business name: mostly letters, not a currency/amount/e-mail/IBAN line,
 * not a generic document header, and reasonably short. This is exactly the
 * field the optional Prompt API pass is best at improving.
 */
export function extractVendor(text: string): Extracted<string> | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const line = lines[i];
    if (line.length > 40 || line.length < 2) {
      continue;
    }
    if (NON_VENDOR.test(line) || line.includes('@') || /\d{2,}/.test(line)) {
      continue;
    }
    // A business name is letters plus a little punctuation ("&", ".", "-").
    // Anything else (symbols, box-drawing OCR noise) is not a vendor line.
    if (!/^[\p{L} &.,'’\-]+$/u.test(line)) {
      continue;
    }
    const letters = (line.match(/\p{L}/gu) ?? []).length;
    if (letters < 2) {
      continue;
    }
    // A name at the very top is more likely the vendor than one lower down.
    return { value: line, confidence: i === 0 ? 'medium' : 'low' };
  }
  return undefined;
}

// =============================================================================
// Top-level
// =============================================================================

/**
 * Run every heuristic over the OCR text and return all fields it could fill.
 * Pure and total: unknown / empty input yields an empty object, never throws.
 */
export function extractFields(text: string): ExtractedFields {
  return {
    date: extractDate(text),
    amount: extractAmount(text),
    currency: extractCurrency(text),
    iban: extractIban(text),
    vendor: extractVendor(text),
    email: extractEmail(text),
  };
}

/** Count how many fields were extracted (used by the demo's DoD assertion). */
export function filledCount(fields: ExtractedFields): number {
  return Object.values(fields).filter((f) => f !== undefined).length;
}
