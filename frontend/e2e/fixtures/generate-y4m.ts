/**
 * generate-y4m.ts — produce a tiny Y4M fixture for Chromium's fake camera.
 *
 * Chromium accepts a raw Y4M (YUV4MPEG2, 4:2:0) file via
 * `--use-file-for-fake-video-capture`. We generate a small clip with a moving
 * block so frames genuinely change — enough to smoke-test that the pose route
 * renders and inference runs. The file is not committed; the Playwright global
 * setup regenerates it before each run.
 */
import { writeFileSync } from 'node:fs';

const WIDTH = 320;
const HEIGHT = 240;
const FRAMES = 8;

/** Write a small animated Y4M (4:2:0) file to `outPath`. */
export function generateY4m(outPath: string): void {
  const header = `YUV4MPEG2 W${WIDTH} H${HEIGHT} F30:1 Ip A1:1 C420\n`;
  const ySize = WIDTH * HEIGHT;
  const cSize = (WIDTH / 2) * (HEIGHT / 2);
  const frameLabel = Buffer.from('FRAME\n', 'ascii');

  const chunks: Buffer[] = [Buffer.from(header, 'ascii')];

  for (let f = 0; f < FRAMES; f++) {
    const y = Buffer.alloc(ySize, 90); // mid-gray luma background
    const u = Buffer.alloc(cSize, 128); // neutral chroma
    const v = Buffer.alloc(cSize, 128);

    // A bright block that slides left-to-right across frames.
    const blockW = 60;
    const blockH = 80;
    const x0 = Math.floor((f / FRAMES) * (WIDTH - blockW));
    const y0 = Math.floor((HEIGHT - blockH) / 2);
    for (let yy = y0; yy < y0 + blockH; yy++) {
      for (let xx = x0; xx < x0 + blockW; xx++) {
        y[yy * WIDTH + xx] = 220; // bright luma
      }
    }

    chunks.push(frameLabel, y, u, v);
  }

  writeFileSync(outPath, Buffer.concat(chunks));
}
