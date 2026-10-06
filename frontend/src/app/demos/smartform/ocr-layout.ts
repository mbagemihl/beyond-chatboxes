/**
 * ocr-layout.ts — uses what the OCR model knows beyond the flat text: WHERE each
 * word sits on the page, and HOW SURE the model was about it.
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

/** A box's height in pixels. */
export function height(box: Box): number {
  return box.y1 - box.y0;
}

/**
 * Step 1 — How many pixels two boxes share vertically: from the lower of the
 * two tops to the higher of the two bottoms, and 0 when they do not overlap at
 * all. Remember y grows DOWNWARDS in image coordinates.
 */
export function verticalOverlap(a: Box, b: Box): number {
  return Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
}

/**
 * Step 2 — True if two boxes sit on the same visual row: they overlap
 * vertically (step 1) by at least HALF the height of the SHORTER box.
 *   * Half, not "any overlap": tall glyphs and slightly skewed photos make
 *     neighbouring rows touch by a pixel or two.
 *   * The shorter box: a small "11,00" beside a big bold "TOTAL" is still on
 *     its row.
 * A box with zero height is on no row.
 */
export function sameRow(a: Box, b: Box): boolean {
  const shorter = Math.min(height(a), height(b));
  return shorter > 0 && verticalOverlap(a, b) >= shorter / 2;
}

/**
 * Step 3 — The words on the same row as `anchor` (step 2) that start to its
 * right (their left edge at or beyond the anchor's right edge), sorted left to
 * right. Never the anchor itself. Tesseract returns words in ITS reading
 * order, which on a two-column receipt is not left to right across the row.
 */
export function wordsRightOf(words: readonly OcrWord[], anchor: OcrWord): OcrWord[] {
  return words
    .filter((w) => w !== anchor && w.bbox.x0 >= anchor.bbox.x1 && sameRow(w.bbox, anchor.bbox))
    .sort((a, b) => a.bbox.x0 - b.bbox.x0);
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
 * Step 4 — The amount to the right of `label` (step 3), or undefined when
 * there is none. Parse it with the given `moneyIn` over the texts of those
 * words joined by a space ("EUR 13,50" is two words), and return it together
 * with the words: they are the evidence the confidence steps judge.
 */
export function amountBeside(
  words: readonly OcrWord[],
  label: OcrWord,
): LabeledValue<number> | undefined {
  const right = wordsRightOf(words, label);
  const value = moneyIn(right.map((w) => w.text).join(' '));
  return value === undefined ? undefined : { value, words: right };
}

/**
 * Find the receipt total by layout: a word matching {@link TOTAL_LABEL} with an
 * amount beside it (step 4). A receipt can carry several labels ("Betrag" as a
 * column header, "Summe", then "Gesamtbetrag"), so look from the bottom of the
 * page up — the grand total comes last — and skip labels with no amount.
 */
export function findLabeledAmount(words: readonly OcrWord[]): LabeledValue<number> | undefined {
  const labels = words
    .filter((w) => TOTAL_LABEL.test(w.text))
    .sort((a, b) => b.bbox.y0 - a.bbox.y0);
  for (const label of labels) {
    const found = amountBeside(words, label);
    if (found) {
      return found;
    }
  }
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
 * Step 5 — The lowest OCR confidence among the words a value was read from
 * (a chain is as strong as its weakest link), or undefined without any words.
 */
export function weakestConfidence(evidence: readonly OcrWord[]): number | undefined {
  return evidence.length === 0 ? undefined : Math.min(...evidence.map((w) => w.confidence));
}

/**
 * Step 6 — The most a value can be trusted, given its weakest word:
 *   - below LOW_BELOW  → `low`;
 *   - below TRUST_FROM → `medium`;
 *   - otherwise        → `high`.
 */
export function capFor(weakest: number): Confidence {
  if (weakest < LOW_BELOW) {
    return 'low';
  }
  return weakest < TRUST_FROM ? 'medium' : 'high';
}

/**
 * Combine what the heuristic thinks of a value with what the OCR model thought
 * of the words it came from (steps 5 and 6). A perfect IBAN checksum means
 * nothing if the digits were read at 40%: the text never tells you that, the
 * word confidences do. Calibration only ever LOWERS confidence: the OCR model
 * cannot vouch for a value more strongly than the rule that extracted it.
 */
export function calibrate(heuristic: Confidence, evidence: readonly OcrWord[]): Confidence {
  const weakest = weakestConfidence(evidence);
  return weakest === undefined ? heuristic : atMost(heuristic, capFor(weakest));
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
