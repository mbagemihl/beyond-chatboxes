/**
 * Unit tests for the pure parts of the optional Prompt API layer — the prompt,
 * reply validation and the non-destructive merge. No browser API, no TestBed.
 */
import { ExtractedFields } from './extract-fields';
import fixture from './ocr-layout.fixture.json';
import { OcrWord } from './ocr-layout';
import { buildPromptInput, mergeFields, parsePromptJson } from './prompt-api';

describe('buildPromptInput', () => {
  const words: readonly OcrWord[] = fixture.words;

  it('fences the OCR text off as data', () => {
    const input = buildPromptInput('  Kaffee 3,80  ', []);
    expect(input).toBe('Receipt OCR text:\n<<<\nKaffee 3,80\n>>>');
  });

  it("tells the model which words the OCR model doubted (the real scan's misread)", () => {
    // Tesseract read "1x Espresso" as "lx", at 51% confidence.
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

describe('parsePromptJson', () => {
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

describe('mergeFields', () => {
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
