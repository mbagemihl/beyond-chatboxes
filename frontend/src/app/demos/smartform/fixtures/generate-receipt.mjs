#!/usr/bin/env node
/**
 * generate-receipt.mjs — produce fixtures/test-receipt.pdf, the printable
 * receipt used to exercise the smart-form OCR demo end-to-end (hold the printout
 * up to the camera and hit "Scan document"). Its text is identical to
 * RECEIPT_TEXT in extract-fields.spec.ts, so the unit tests and the live demo
 * fill the same six fields.
 *
 * Emits a minimal, dependency-free PDF: one A5 page of 13pt Courier (monospace —
 * the cleanest target for Tesseract), WinAnsiEncoding for the German umlauts.
 * The euro amount is written as the ISO code "EUR" rather than the € glyph
 * because Tesseract reads letters far more reliably than currency symbols.
 *
 * Run: `node src/app/demos/smartform/fixtures/generate-receipt.mjs`
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// WinAnsi octal escapes: ß=\337, ä=\344, ü=\374. Parens/backslash are escaped.
const LINES = [
  'Kaffeehaus Berlin GmbH',
  'Friedrichstra\\337e 120',
  '10117 Berlin',
  '',
  'Rechnung Nr. 2026-0042',
  'Datum: 15.07.2026',
  '',
  'Beschreibung        Betrag',
  'Espresso Doppio     3,80 EUR',
  'K\\344sekuchen          4,50 EUR',
  'Mineralwasser       2,70 EUR',
  '',
  'Gesamtbetrag:      11,00 EUR',
  '',
  'IBAN: DE89 3704 0044 0532 0130 00',
  'E-Mail: buchhaltung@kaffeehaus-berlin.de',
  'Vielen Dank f\\374r Ihren Besuch!',
];

const FONT_SIZE = 13;
const LEADING = 22;
const START_X = 40;
const START_Y = 555;

// Build the text content stream: set font + leading, position, then one line per
// row (blank rows just advance with T*).
const body = LINES.map((line) => (line ? `(${line}) Tj T*` : 'T*')).join('\n');
const content = `BT\n/F1 ${FONT_SIZE} Tf\n${LEADING} TL\n${START_X} ${START_Y} Td\n${body}\nET`;

// Assemble the objects, tracking byte offsets for the xref table.
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] ' +
    '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
];

let pdf = '%PDF-1.4\n';
const offsets = [];
objects.forEach((obj, i) => {
  offsets.push(pdf.length);
  pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
});

const xrefStart = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n`;
pdf += '0000000000 65535 f \n';
for (const offset of offsets) {
  pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
pdf += `startxref\n${xrefStart}\n%%EOF`;

const out = resolve(dirname(fileURLToPath(import.meta.url)), 'test-receipt.pdf');
// latin1 so each WinAnsi octal escape stays a single byte.
writeFileSync(out, pdf, 'latin1');
console.log(`[generate-receipt] wrote ${out} (${pdf.length} bytes)`);
