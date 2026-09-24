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

/**
 * True if two boxes sit on the same visual row: their vertical extents overlap
 * by at least half the height of the shorter one. Half, not "any overlap",
 * because tall glyphs and slightly skewed photos make neighbouring rows touch;
 * and relative to the SHORTER box so a small word beside a big one still counts.
 */
export function sameRow(a: Box, b: Box): boolean {
  const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  const shorter = Math.min(a.y1 - a.y0, b.y1 - b.y0);
  return shorter > 0 && overlap >= shorter / 2;
}

/**
 * The words on the same row as `anchor` that start to its right, in reading
 * order (left to right). The anchor itself is never included.
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
 * Find the receipt total by layout: a word matching {@link TOTAL_LABEL} with an
 * amount to its right on the same row. `words` are the value's words (those
 * right of the label), which is the evidence {@link calibrate} judges.
 *
 * A receipt can carry several labels ("Betrag" as a column header, "Summe",
 * then "Gesamtbetrag"). Skip any label with no amount beside it, and of the
 * rest prefer the one LOWEST on the page — the grand total comes last.
 */
export function findLabeledAmount(words: readonly OcrWord[]): LabeledValue<number> | undefined {
  let best: (LabeledValue<number> & { readonly y: number }) | undefined;
  for (const label of words) {
    if (!TOTAL_LABEL.test(label.text)) {
      continue;
    }
    const right = wordsRightOf(words, label);
    const value = moneyIn(right.map((w) => w.text).join(' '));
    if (value === undefined) {
      continue;
    }
    if (!best || label.bbox.y0 > best.y) {
      best = { value, words: right, y: label.bbox.y0 };
    }
  }
  return best && { value: best.value, words: best.words };
}

// =============================================================================
// Confidence
// =============================================================================

/** Below this word confidence, a field is at best a `low` guess. */
export const LOW_BELOW = 60;
/** From this word confidence up, the heuristic's own confidence stands. */
export const TRUST_FROM = 85;

/**
 * Combine what the heuristic thinks of a value with what the OCR model thought
 * of the words it came from. A perfect IBAN checksum means nothing if the
 * digits were read at 40% — one misread digit that still passes mod-97 is rare,
 * but "rare" is not a promise you print on a badge.
 *
 * The weakest word decides (a chain is as strong as its weakest link):
 *   - no evidence at all       → keep the heuristic's confidence unchanged;
 *   - weakest word < LOW_BELOW  → `low`;
 *   - weakest word < TRUST_FROM → at most `medium`;
 *   - otherwise                 → the heuristic's confidence.
 *
 * Calibration only ever lowers confidence; the OCR model cannot vouch for a
 * value more strongly than the rule that extracted it.
 */
export function calibrate(heuristic: Confidence, evidence: readonly OcrWord[]): Confidence {
  if (evidence.length === 0) {
    return heuristic;
  }
  const weakest = Math.min(...evidence.map((w) => w.confidence));
  if (weakest < LOW_BELOW) {
    return 'low';
  }
  if (weakest < TRUST_FROM) {
    return heuristic === 'high' ? 'medium' : heuristic;
  }
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
