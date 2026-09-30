/**
 * The demos, in stage order. Single source of truth shared by the landing
 * page cards and the global number-key shortcuts, so the number printed on a
 * card is always the key that opens it. The talk uses 1–4; the workshop's
 * still-image view (Act 2a) comes last so those keys stay the same.
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
  {
    path: 'pose/still',
    title: 'Pose, still image',
    tech: 'LiteRT.js vs DJL · one image',
    blurb: 'One image through the browser model, checked against the backend.',
  },
];
