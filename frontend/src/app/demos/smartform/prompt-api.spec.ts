/**
 * Unit tests for the pure parts of the optional Prompt API layer — the prompt,
 * reply validation and the non-destructive merge. No browser API, no TestBed.
 */
import { ExtractedFields } from './extract-fields';
import fixture from './ocr-layout.fixture.json';
import { OcrWord } from './ocr-layout';
import {
  buildPromptInput,
  canOverride,
  cleanIban,
  fenceAsData,
  jsonObjectIn,
  mergeFields,
  parsePromptJson,
  unsureWords,
  validateReply,
} from './prompt-api';

const words: readonly OcrWord[] = fixture.words;

describe('Stretch 1 · fenceAsData', () => {
  it('fences the trimmed OCR text off as data', () => {
    expect(fenceAsData('  Kaffee 3,80  ')).toBe('Receipt OCR text:\n<<<\nKaffee 3,80\n>>>');
  });
});

describe('Stretch 2 · unsureWords', () => {
  it("lists the words the OCR model doubted (the real scan's misread)", () => {
    // Tesseract read "1x Espresso" as "lx", at 51% confidence.
    expect(unsureWords(words)).toEqual(['"lx" (51%)']);
  });

  it('skips blank words and lists at most 20', () => {
    const doubt = (text: string): OcrWord => ({
      text,
      confidence: 30.4,
      bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
    });
    expect(unsureWords([doubt(' '), doubt('O0')])).toEqual(['"O0" (30%)']);
    expect(unsureWords(new Array(30).fill(doubt('x'))).length).toBe(20);
  });
});

describe('Prompt (given buildPromptInput)', () => {
  it('tells the model which words the OCR model doubted', () => {
    const input = buildPromptInput(fixture.text, words);
    expect(input).toContain('"lx" (51%)');
  });

  it('does not list confidently read words', () => {
    const input = buildPromptInput(fixture.text, words);
    expect(input).not.toContain('"TOTAL"');
    expect(input.match(/\(\d+%\)/g)).toEqual(['(51%)']);
  });

  it('omits the uncertainty section when nothing was doubted', () => {
    const confident = words.filter((w) => w.confidence >= 60);
    expect(buildPromptInput(fixture.text, confident)).not.toContain('unsure');
  });
});

describe('Stretch 3 · jsonObjectIn', () => {
  it('parses a clean JSON object', () => {
    expect(jsonObjectIn('{"vendor":"Acme AG"}')).toEqual({ vendor: 'Acme AG' });
  });

  it('recovers JSON wrapped in prose / code fences', () => {
    expect(jsonObjectIn('Sure! ```json\n{"email":"a@b.com"}\n``` done')).toEqual({
      email: 'a@b.com',
    });
  });

  it('is undefined for non-JSON, or a reply cut off mid-object', () => {
    expect(jsonObjectIn('I could not read it.')).toBeUndefined();
    expect(jsonObjectIn('{"vendor":"Acme","amount":')).toBeUndefined();
  });
});

describe('Stretch 4 · validateReply', () => {
  it('accepts a reply with some keys missing', () => {
    expect(validateReply({ vendor: 'Acme', amount: 42.5 })).toEqual({
      vendor: 'Acme',
      amount: 42.5,
    });
  });

  it('rejects the whole reply when any field has the wrong type', () => {
    expect(validateReply({ vendor: 'Acme', amount: 'about twelve' })).toBeNull();
  });

  it('rejects something that is not an object at all', () => {
    expect(validateReply(undefined)).toBeNull();
  });
});

describe('Validation (given parsePromptJson)', () => {
  it('parses a clean JSON object', () => {
    const out = parsePromptJson('{"vendor":"Acme AG","amount":42.5,"foo":"bar"}');
    expect(out).toEqual({ vendor: 'Acme AG', amount: '42.5' });
  });

  it('recovers JSON wrapped in prose / code fences', () => {
    const out = parsePromptJson('Sure! ```json\n{"email":"a@b.com"}\n``` done');
    expect(out).toEqual({ email: 'a@b.com' });
  });

  it('returns {} for non-JSON', () => {
    expect(parsePromptJson('I could not read it.')).toEqual({});
  });

  it('drops nulls and blank strings — "not on this receipt"', () => {
    expect(parsePromptJson('{"vendor":"Acme","iban":null,"email":"  "}')).toEqual({
      vendor: 'Acme',
    });
  });

  it('rejects the whole reply when any field has the wrong type', () => {
    expect(parsePromptJson('{"vendor":"Acme","amount":"about twelve"}')).toEqual({});
  });

  it('returns {} for a reply cut off mid-object', () => {
    expect(parsePromptJson('{"vendor":"Acme","amount":')).toEqual({});
  });
});

describe('Stretch 5 · canOverride', () => {
  it('lets the model fill a missing field, or replace a weak guess', () => {
    expect(canOverride(undefined)).toBe(true);
    expect(canOverride({ value: 'x', confidence: 'low' })).toBe(true);
    expect(canOverride({ value: 'x', confidence: 'medium' })).toBe(true);
  });

  it('never lets it replace a high-confidence value', () => {
    expect(canOverride({ value: 'x', confidence: 'high' })).toBe(false);
  });
});

describe('Stretch 6 · cleanIban', () => {
  it('strips spaces and uppercases a valid IBAN', () => {
    expect(cleanIban('de89 3704 0044 0532 0130 00')).toBe('DE89370400440532013000');
  });

  it('rejects a hallucinated IBAN that fails the checksum', () => {
    expect(cleanIban('DE00 0000 0000 0000 0000 00')).toBeUndefined();
  });
});

describe('Trust policy (given mergeFields)', () => {
  it('never overrides a high-confidence heuristic value', () => {
    const heuristic: ExtractedFields = {
      iban: { value: 'DE89370400440532013000', confidence: 'high' },
    };
    const out = mergeFields(heuristic, { iban: 'GB82WEST12345698765432' });
    expect(out.iban).toEqual({ value: 'DE89370400440532013000', confidence: 'high' });
  });

  it('fills a field the heuristic missed, tagged medium', () => {
    const out = mergeFields({}, { vendor: 'Kaffeehaus Berlin GmbH' });
    expect(out.vendor).toEqual({ value: 'Kaffeehaus Berlin GmbH', confidence: 'medium' });
  });

  it('improves the weak vendor guess (low → model medium)', () => {
    const heuristic: ExtractedFields = {
      vendor: { value: 'Friedrichstraße', confidence: 'low' },
    };
    const out = mergeFields(heuristic, { vendor: 'Kaffeehaus Berlin GmbH' });
    expect(out.vendor?.value).toBe('Kaffeehaus Berlin GmbH');
  });

  it('rejects a hallucinated invalid IBAN', () => {
    const out = mergeFields({}, { iban: 'DE00 0000 0000 0000 0000 00' });
    expect(out.iban).toBeUndefined();
  });

  it('normalizes a model date and drops an unparseable one', () => {
    expect(mergeFields({}, { date: '2026-07-15' }).date?.value).toBe('2026-07-15');
    expect(mergeFields({}, { date: 'whenever' }).date).toBeUndefined();
  });
});
