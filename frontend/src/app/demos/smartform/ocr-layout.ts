/**
 * ocr-layout.ts — uses what the OCR model knows beyond the flat text: WHERE each
 * word sits on the page, and HOW SURE the model was about it.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ BONUS TRACK "ocr" — Reading a document on-device                        │
 * │                                                                         │
 * │ The OCR model gives you more than text: a bounding box and a confidence │
 * │ for every word. Use them. The string heuristics in extract-fields.ts    │
 * │ are given — that part is business logic, not this block's lesson.      │
 * │                                                                         │
 * │ Core: the functions marked TODO below.                                  │
 * │ Stretch: the on-device LLM layer, TODOs in prompt-api.ts.               │
 * │   Check your work:  make verify-bonus-ocr                               │
 * │   Stuck?            make solve-bonus-ocr                                │
 * │                                                                         │
 * │ Watch it work:  http://localhost:4200/smartform?fixture=1               │
 * │ Hit "Scan document": the amount badge reads "medium" (found by text     │
 * │ alone) until findLabeledAmount pairs it with its label — then "high".   │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * `extract-fields.ts` works on `data.text`, which is lossy: Tesseract's page
 * segmentation regularly splits a two-column receipt into separate text blocks,
 * so "Total" and "11,00" end up lines apart and a line-based heuristic never
 * pairs them. And plain text carries no uncertainty at all — a word read at 30%
 * confidence looks exactly like one read at 99%. Both signals are in the model
 * output (per-word bounding boxes and confidences); this module uses them.
 *
 * No Angular / DOM / Tesseract dependencies on purpose: OcrService flattens the
 * recognizer's result into plain {@link OcrWord}s, so everything here is
 * unit-testable with hand-built or recorded words (see ocr-layout.spec.ts).
 */
import { Confidence, Extracted, ExtractedFields, extractFields, moneyIn } from './extract-fields';

/** An axis-aligned box in image pixels; y grows downwards. */
export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** One recognized word, as the OCR model reported it. */
export interface OcrWord {
  readonly text: string;
  /** The model's confidence in this word, 0–100. */
  readonly confidence: number;
  readonly bbox: Box;
}

// =============================================================================
// Layout
// =============================================================================

/**
 * TODO (bonus ocr, core) — True if two boxes sit on the same visual row.
 *
 * The rule the specs expect: their vertical extents overlap by at least HALF
 * the height of the SHORTER box.
 *   * Half, not "any overlap": tall glyphs and slightly skewed photos make
 *     neighbouring rows touch by a pixel or two.
 *   * The shorter box: a small "11,00" beside a big bold "TOTAL" is still on
 *     its row.
 * A box with zero height is on no row.
 *
 * Remember y grows DOWNWARDS in image coordinates.
 */
export function sameRow(a: Box, b: Box): boolean {
  return false;
}

/**
 * TODO (bonus ocr, core) — The words on the same row as `anchor` that start to
 * its right (their left edge at or beyond the anchor's right edge), in reading
 * order, left to right. Never include the anchor itself.
 *
 * Tesseract returns words in ITS reading order, which on a two-column receipt
 * is not left to right across the row — sort them yourself.
 */
export function wordsRightOf(words: readonly OcrWord[], anchor: OcrWord): OcrWord[] {
  return [];
}

/**
 * A single word that labels the receipt total (EN + DE). Anchored at both ends
 * so "Subtotal" and "Zwischensumme" do NOT match, and a trailing colon is fine.
 */
export const TOTAL_LABEL =
  /^(total|gesamt|gesamtbetrag|gesamtsumme|summe|betrag|endbetrag|rechnungsbetrag|balance):?$/i;

/** A value found next to a label, plus the words it was read from. */
export interface LabeledValue<T> {
  readonly value: T;
  readonly words: readonly OcrWord[];
}

/**
 * TODO (bonus ocr, core) — Find the receipt total by layout: a word matching
 * {@link TOTAL_LABEL} with an amount to its right on the same row.
 *
 * Parse the amount with the given `moneyIn` over the words right of the label
 * (join their texts with a space: "EUR 13,50" is two words). Return that value
 * together with those words — they are the evidence `calibrate` will judge.
 *
 * A receipt can carry several labels ("Betrag" as a column header, "Summe",
 * then "Gesamtbetrag"):
 *   * skip a label with no amount beside it;
 *   * of the rest, prefer the one LOWEST on the page (largest y) — the grand
 *     total comes last. Do not rely on the order of `words`.
 */
export function findLabeledAmount(words: readonly OcrWord[]): LabeledValue<number> | undefined {
  return undefined;
}

// =============================================================================
// Confidence
// =============================================================================

/** Below this word confidence, a field is at best a `low` guess. */
export const LOW_BELOW = 60;
/** From this word confidence up, the heuristic's own confidence stands. */
export const TRUST_FROM = 85;

/**
 * TODO (bonus ocr, core) — Combine what the heuristic thinks of a value with what
 * the OCR model thought of the words it came from.
 *
 * A perfect IBAN checksum means nothing if the digits were read at 40%. The
 * text never tells you that; the word confidences do.
 *
 * The weakest word decides (a chain is as strong as its weakest link):
 *   - no evidence at all        → keep the heuristic's confidence unchanged;
 *   - weakest word < LOW_BELOW  → `low`;
 *   - weakest word < TRUST_FROM → at most `medium`;
 *   - otherwise                 → the heuristic's confidence.
 *
 * Calibration only ever LOWERS confidence: the OCR model cannot vouch for a
 * value more strongly than the rule that extracted it.
 */
export function calibrate(heuristic: Confidence, evidence: readonly OcrWord[]): Confidence {
  return heuristic;
}

// =============================================================================
// Top-level (given)
// =============================================================================

const ORDER: readonly Confidence[] = ['low', 'medium', 'high'];

function atMost(confidence: Confidence, cap: Confidence): Confidence {
  return ORDER[Math.min(ORDER.indexOf(confidence), ORDER.indexOf(cap))];
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * The words an extracted value was plausibly read from. A word supports the
 * value if its letters/digits appear inside the value's ("DE89" inside the
 * IBAN), or, for values with separators, if it contains every part of it — so
 * the ISO date 2026-07-15 finds the word "15.07.2026".
 */
export function supportingWords(value: string, words: readonly OcrWord[]): OcrWord[] {
  const target = normalize(value);
  const parts = value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((p) => p.length >= 2);
  return words.filter((w) => {
    const text = normalize(w.text);
    if (text.length < 2) {
      return false;
    }
    return target.includes(text) || (parts.length > 1 && parts.every((p) => text.includes(p)));
  });
}

function calibrated<T>(
  field: Extracted<T> | undefined,
  words: readonly OcrWord[],
): Extracted<T> | undefined {
  if (!field) {
    return undefined;
  }
  const raw = typeof field.value === 'number' ? field.value.toFixed(2) : String(field.value);
  return {
    value: field.value,
    confidence: calibrate(field.confidence, supportingWords(raw, words)),
  };
}

/**
 * The full OCR → fields step: the text heuristics from extract-fields.ts, with
 * the amount taken from the page layout when a labelled total exists, and every
 * field's confidence calibrated against the OCR model's per-word confidence.
 *
 * An amount the text heuristic found without a label beside it is capped at
 * `medium`: it sat on a currency line, but nothing on the page says "total".
 */
export function extractFieldsFromOcr(text: string, words: readonly OcrWord[]): ExtractedFields {
  const base = extractFields(text);
  const labeled = findLabeledAmount(words);
  const textAmount = calibrated(base.amount, words);
  return {
    date: calibrated(base.date, words),
    amount: labeled
      ? { value: labeled.value, confidence: calibrate('high', labeled.words) }
      : textAmount && {
          value: textAmount.value,
          confidence: atMost(textAmount.confidence, 'medium'),
        },
    currency: calibrated(base.currency, words),
    iban: calibrated(base.iban, words),
    vendor: calibrated(base.vendor, words),
    email: calibrated(base.email, words),
  };
}
