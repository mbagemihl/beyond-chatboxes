/**
 * Unit tests for ocr-layout.ts — pure functions, no TestBed, no OCR at test
 * time. Hand-built words pin down each rule; the last groups replay genuine
 * Tesseract output for the bundled receipt (ocr-layout.fixture.json, from
 * scripts/generate-ocr-fixture.mjs).
 */
import fixture from './ocr-layout.fixture.json';
import {
  OcrWord,
  calibrate,
  extractFieldsFromOcr,
  findLabeledAmount,
  sameRow,
  wordsRightOf,
} from './ocr-layout';

/** A word at (x0, y0) of the given width, 20px tall unless stated. */
function word(
  text: string,
  x0: number,
  y0: number,
  confidence = 95,
  width = 60,
  height = 20,
): OcrWord {
  return { text, confidence, bbox: { x0, y0, x1: x0 + width, y1: y0 + height } };
}

const realWords: readonly OcrWord[] = fixture.words;

describe('sameRow', () => {
  it('is true for boxes on the same line', () => {
    expect(sameRow(word('a', 0, 100).bbox, word('b', 300, 102).bbox)).toBe(true);
  });

  it('is false for the next line down', () => {
    expect(sameRow(word('a', 0, 100).bbox, word('b', 0, 130).bbox)).toBe(false);
  });

  it('is false when rows merely touch (overlap under half a line)', () => {
    // 0–20 and 15–35 overlap by 5px: neighbouring rows, not one row.
    expect(sameRow(word('a', 0, 0).bbox, word('b', 0, 15).bbox)).toBe(false);
  });

  it('measures overlap against the SHORTER box', () => {
    // A 15px word inside a 40px-tall word's band is on its row.
    const tall = word('TOTAL', 0, 0, 95, 60, 40).bbox;
    const small = word('11,00', 300, 10, 95, 60, 15).bbox;
    expect(sameRow(tall, small)).toBe(true);
  });

  it('is false for a zero-height box', () => {
    expect(sameRow(word('a', 0, 0).bbox, word('b', 0, 0, 95, 60, 0).bbox)).toBe(false);
  });
});

describe('wordsRightOf', () => {
  const label = word('Total', 0, 100);
  const far = word('EUR', 400, 101);
  const near = word('11,00', 200, 99);
  const left = word('Rechnung', -200, 100);
  const below = word('IBAN', 200, 140);

  it('returns same-row words to the right, left to right', () => {
    expect(wordsRightOf([far, label, below, near, left], label)).toEqual([near, far]);
  });

  it('never includes the anchor itself', () => {
    expect(wordsRightOf([label], label)).toEqual([]);
  });
});

describe('findLabeledAmount', () => {
  it('pairs a label with an amount far across the row (split columns)', () => {
    const value = word('42,50', 600, 300);
    const found = findLabeledAmount([word('Total', 0, 300), value]);
    expect(found?.value).toBe(42.5);
    expect(found?.words).toEqual([value]);
  });

  it('does not take the subtotal', () => {
    const words = [
      word('Subtotal', 0, 200),
      word('40,00', 400, 200),
      word('Total:', 0, 260),
      word('42,50', 400, 260),
    ];
    expect(findLabeledAmount(words)?.value).toBe(42.5);
  });

  it('skips a label with no amount beside it (a column header)', () => {
    const words = [word('Betrag', 400, 0), word('Summe', 0, 100), word('11,00', 400, 100)];
    expect(findLabeledAmount(words)?.value).toBe(11);
  });

  it('prefers the label lowest on the page, whatever the word order', () => {
    const words = [
      word('Gesamtbetrag:', 0, 200, 95, 150),
      word('11,90', 400, 200),
      word('Summe', 0, 100),
      word('10,00', 400, 100),
    ];
    expect(findLabeledAmount(words)?.value).toBe(11.9);
  });

  it('returns undefined when nothing on the page is labelled a total', () => {
    expect(findLabeledAmount([word('Espresso', 0, 0), word('2,50', 300, 0)])).toBeUndefined();
  });

  it('finds the total on the real receipt scan', () => {
    const found = findLabeledAmount(realWords);
    expect(found?.value).toBe(13.5);
    expect(found?.words.map((w) => w.text)).toEqual(['EUR', '13,50']);
  });
});

describe('calibrate', () => {
  const sure = word('x', 0, 0, 96);
  const unsure = word('x', 0, 0, 70);
  const weak = word('x', 0, 0, 40);

  it('keeps the heuristic confidence without evidence', () => {
    expect(calibrate('high', [])).toBe('high');
    expect(calibrate('low', [])).toBe('low');
  });

  it('keeps it when every word was read confidently', () => {
    expect(calibrate('high', [sure, sure])).toBe('high');
  });

  it('caps at medium when a word was read with moderate confidence', () => {
    expect(calibrate('high', [sure, unsure])).toBe('medium');
  });

  it('drops to low when any word was barely read', () => {
    expect(calibrate('high', [sure, weak])).toBe('low');
    expect(calibrate('medium', [weak])).toBe('low');
  });

  it('never raises confidence', () => {
    expect(calibrate('medium', [sure])).toBe('medium');
    expect(calibrate('low', [unsure])).toBe('low');
  });

  it('puts the thresholds at exactly 60 and 85', () => {
    expect(calibrate('high', [word('x', 0, 0, 60)])).toBe('medium');
    expect(calibrate('high', [word('x', 0, 0, 59.9)])).toBe('low');
    expect(calibrate('high', [word('x', 0, 0, 85)])).toBe('high');
  });
});

describe('extractFieldsFromOcr on the real receipt scan', () => {
  it('fills every field, each with the right confidence', () => {
    expect(extractFieldsFromOcr(fixture.text, realWords)).toEqual({
      date: { value: '2026-06-12', confidence: 'high' },
      amount: { value: 13.5, confidence: 'high' },
      currency: { value: 'EUR', confidence: 'high' },
      iban: { value: 'DE89370400440532013000', confidence: 'high' },
      vendor: { value: 'Nordlicht Kaffee', confidence: 'medium' },
      email: { value: 'rechnung@nordlicht-kaffee.de', confidence: 'high' },
    });
  });

  it('downgrades a checksum-valid IBAN whose digits were barely read', () => {
    const shaky = realWords.map((w) => (w.text === '0532' ? { ...w, confidence: 40 } : w));
    expect(extractFieldsFromOcr(fixture.text, shaky).iban?.confidence).toBe('low');
  });

  it('caps an amount found without a label beside it at medium', () => {
    const unlabeled = realWords.filter((w) => w.text !== 'TOTAL');
    expect(extractFieldsFromOcr(fixture.text, unlabeled).amount).toEqual({
      value: 13.5,
      confidence: 'medium',
    });
  });
});
