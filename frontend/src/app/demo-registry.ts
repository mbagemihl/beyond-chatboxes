/**
 * The four demos, in stage order. Single source of truth shared by the
 * landing page cards and the global 1–4 keyboard shortcuts, so the number
 * printed on a card is always the key that opens it.
 */
export interface DemoEntry {
  /** Router path (no leading slash). */
  readonly path: string;
  /** Big card title on the landing page. */
  readonly title: string;
  /** What runs where — the tech line under the title. */
  readonly tech: string;
  /** One sentence of what the audience will see. */
  readonly blurb: string;
}

export const DEMOS: readonly DemoEntry[] = [
  {
    path: 'pose',
    title: 'Pose',
    tech: 'MoveNet · LiteRT.js · WebGPU',
    blurb: 'Live skeleton tracking and joint angles, entirely in the browser.',
  },
  {
    path: 'search',
    title: 'Semantic Search',
    tech: 'MiniLM · Transformers.js · Web Worker',
    blurb: 'Meaning-based search over a local corpus — no server, no index API.',
  },
  {
    path: 'smartform',
    title: 'Smart Form',
    tech: 'Tesseract.js OCR · on-device',
    blurb: 'Scan a receipt, watch the form fill itself. Zero bytes uploaded.',
  },
  {
    path: 'benchmark',
    title: 'Local vs Cloud',
    tech: 'LiteRT.js vs Spring Boot + DJL',
    blurb: 'The same model, raced in the browser and on the server.',
  },
];
