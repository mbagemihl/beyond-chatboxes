/**
 * Unit tests for the pure parts of the optional Prompt API layer — JSON parsing
 * and the non-destructive merge. No browser API, no TestBed.
 */
import { ExtractedFields } from './extract-fields';
import { mergeFields, parsePromptJson } from './prompt-api';

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
