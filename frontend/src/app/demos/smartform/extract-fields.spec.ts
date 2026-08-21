/**
 * Unit tests for the pure field-extraction heuristics. No TestBed, no DOM — just
 * strings in, structured fields out. Covers ≥10 fixture strings including German
 * (dotted dates, comma decimals, "Gesamtbetrag") and US/UK formats, plus the
 * exact text of the printable PDF test receipt (see fixtures/test-receipt.*).
 */
import {
  extractAmount,
  extractCurrency,
  extractDate,
  extractEmail,
  extractFields,
  extractIban,
  extractVendor,
  filledCount,
  isValidIban,
  parseMoney,
} from './extract-fields';

/**
 * The text a good OCR pass produces from fixtures/test-receipt.pdf. Kept in sync
 * with the PDF so the "receipt fills ≥4/6 fields" definition-of-done is a real,
 * fast unit assertion and not only an end-to-end check.
 */
const RECEIPT_TEXT = [
  'Kaffeehaus Berlin GmbH',
  'Friedrichstraße 120',
  '10117 Berlin',
  '',
  'Rechnung Nr. 2026-0042',
  'Datum: 15.07.2026',
  '',
  'Beschreibung              Betrag',
  'Espresso Doppio            3,80 EUR',
  'Käsekuchen                 4,50 EUR',
  'Mineralwasser              2,70 EUR',
  '',
  'Gesamtbetrag:             11,00 EUR',
  '',
  'IBAN: DE89 3704 0044 0532 0130 00',
  'E-Mail: buchhaltung@kaffeehaus-berlin.de',
  'Vielen Dank für Ihren Besuch!',
].join('\n');

describe('isValidIban', () => {
  it('accepts a checksum-valid German IBAN (with and without spaces)', () => {
    expect(isValidIban('DE89 3704 0044 0532 0130 00')).toBe(true);
    expect(isValidIban('DE89370400440532013000')).toBe(true);
  });

  it('accepts a valid GB IBAN', () => {
    expect(isValidIban('GB82 WEST 1234 5698 7654 32')).toBe(true);
  });

  it('rejects a wrong checksum', () => {
    expect(isValidIban('DE90 3704 0044 0532 0130 00')).toBe(false);
  });

  it('rejects a malformed string', () => {
    expect(isValidIban('NOT-AN-IBAN')).toBe(false);
    expect(isValidIban('DE8')).toBe(false);
  });
});

describe('extractIban', () => {
  it('finds a valid IBAN split into groups by OCR', () => {
    const out = extractIban('Bank details IBAN DE89 3704 0044 0532 0130 00 thanks');
    expect(out).toEqual({ value: 'DE89370400440532013000', confidence: 'high' });
  });

  it('ignores a plausible but checksum-invalid IBAN', () => {
    expect(extractIban('IBAN DE90 3704 0044 0532 0130 00')).toBeUndefined();
  });
});

describe('extractEmail', () => {
  it('extracts and lowercases an address, trimming trailing punctuation', () => {
    const out = extractEmail('Contact: Buchhaltung@Kaffeehaus-Berlin.DE.');
    expect(out).toEqual({ value: 'buchhaltung@kaffeehaus-berlin.de', confidence: 'high' });
  });

  it('returns undefined when there is no address', () => {
    expect(extractEmail('no email here')).toBeUndefined();
  });
});

describe('parseMoney', () => {
  it('parses German thousands+decimal (1.234,56 → 1234.56)', () => {
    expect(parseMoney('1.234,56')).toBeCloseTo(1234.56, 6);
  });

  it('parses US thousands+decimal (1,234.56 → 1234.56)', () => {
    expect(parseMoney('1,234.56')).toBeCloseTo(1234.56, 6);
  });

  it('parses a plain comma decimal (12,50 → 12.5)', () => {
    expect(parseMoney('12,50')).toBeCloseTo(12.5, 6);
  });

  it('treats a single dot with 3 trailing digits as thousands (1.234 → 1234)', () => {
    expect(parseMoney('1.234')).toBe(1234);
  });

  it('parses a bare integer', () => {
    expect(parseMoney('42')).toBe(42);
  });
});

describe('extractCurrency', () => {
  it('maps the euro symbol to EUR', () => {
    expect(extractCurrency('Summe 11,00 €')).toEqual({ value: 'EUR', confidence: 'high' });
  });

  it('maps $ to USD and £ to GBP', () => {
    expect(extractCurrency('Total $19.99')?.value).toBe('USD');
    expect(extractCurrency('Total £19.99')?.value).toBe('GBP');
  });
});

describe('extractAmount', () => {
  it('picks the total line amount, not the line items (German)', () => {
    const text = 'Kaffee 3,80 €\nKuchen 4,50 €\nGesamtbetrag: 11,00 €';
    expect(extractAmount(text)).toEqual({ value: 11, confidence: 'high' });
  });

  it('reads a US-formatted total', () => {
    expect(extractAmount('Amount due: $1,234.56')).toEqual({ value: 1234.56, confidence: 'high' });
  });

  it('ignores dates and IBAN digits when there is no currency/total line', () => {
    expect(extractAmount('Datum 15.07.2026\nIBAN DE89 3704 0044')).toBeUndefined();
  });
});

describe('extractDate', () => {
  it('parses a German dotted date to ISO', () => {
    expect(extractDate('Datum: 15.07.2026')).toEqual({ value: '2026-07-15', confidence: 'high' });
  });

  it('parses a two-digit German year', () => {
    expect(extractDate('am 03.09.26')).toEqual({ value: '2026-09-03', confidence: 'high' });
  });

  it('parses an ISO date', () => {
    expect(extractDate('date 2026-07-15 ok')).toEqual({ value: '2026-07-15', confidence: 'high' });
  });

  it('parses a textual German month (medium confidence)', () => {
    expect(extractDate('15. Juli 2026')).toEqual({ value: '2026-07-15', confidence: 'medium' });
  });

  it('parses a textual English month (medium confidence)', () => {
    expect(extractDate('Jul 15, 2026')).toEqual({ value: '2026-07-15', confidence: 'medium' });
  });

  it('is not fooled by an invoice number like 2026-0042', () => {
    expect(extractDate('Rechnung Nr. 2026-0042')).toBeUndefined();
  });
});

describe('extractVendor', () => {
  it('takes the top business-name line', () => {
    expect(extractVendor(RECEIPT_TEXT)).toEqual({
      value: 'Kaffeehaus Berlin GmbH',
      confidence: 'medium',
    });
  });

  it('skips header keywords and address lines with numbers', () => {
    const text = 'RECHNUNG\nMusterstraße 12\nAcme Consulting AG\n';
    expect(extractVendor(text)).toEqual({ value: 'Acme Consulting AG', confidence: 'low' });
  });
});

describe('extractFields on the printed test receipt', () => {
  const fields = extractFields(RECEIPT_TEXT);

  it('fills at least 4 of 6 fields (definition of done)', () => {
    expect(filledCount(fields)).toBeGreaterThanOrEqual(4);
  });

  it('extracts every field correctly', () => {
    expect(fields.date?.value).toBe('2026-07-15');
    expect(fields.amount?.value).toBe(11);
    expect(fields.currency?.value).toBe('EUR');
    expect(fields.iban?.value).toBe('DE89370400440532013000');
    expect(fields.email?.value).toBe('buchhaltung@kaffeehaus-berlin.de');
    expect(fields.vendor?.value).toBe('Kaffeehaus Berlin GmbH');
  });
});

describe('extractFields on empty / junk input', () => {
  it('returns no fields and never throws', () => {
    expect(filledCount(extractFields(''))).toBe(0);
    expect(filledCount(extractFields('░▒▓ nonsense ▓▒░'))).toBe(0);
  });
});
