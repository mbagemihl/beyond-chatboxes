/** Unit tests for compare-tiers.ts. */
import { KEYPOINT_NAMES, Keypoint } from '../pose/pose-math';
import { compareTiers, toKeypoints } from './compare-tiers';

function kps(score = 0.9, x = 0.5, y = 0.5): Keypoint[] {
  return KEYPOINT_NAMES.map(() => ({ x, y, score }));
}

describe('toKeypoints', () => {
  it('orders the backend keypoints by name, as the browser does', () => {
    const named = KEYPOINT_NAMES.map((name, i) => ({ name, x: i / 100, y: 0, score: 1 })).reverse();
    const out = toKeypoints(named);
    expect(out?.[0].x).toBe(0);
    expect(out?.[16].x).toBeCloseTo(0.16);
  });

  it('returns null when a keypoint is missing', () => {
    expect(toKeypoints([{ name: 'nose', x: 0, y: 0, score: 1 }])).toBeNull();
  });
});

describe('compareTiers', () => {
  it('reports the largest pixel distance and where it is', () => {
    const server = kps();
    server[0] = { x: 0.5 + 3 / 640, y: 0.5 + 4 / 480, score: 0.9 };
    const diff = compareTiers(kps(), server, 640, 480);
    expect(diff?.maxPx).toBeCloseTo(5, 6);
    expect(diff?.worst).toBe('nose');
    expect(diff?.compared).toBe(17);
  });

  it('only compares keypoints both tiers are confident about', () => {
    const server = kps();
    server[0] = { x: 0, y: 0, score: 0.1 };
    expect(compareTiers(kps(), server, 640, 480)?.compared).toBe(16);
  });

  it('is null when nothing is confident', () => {
    expect(compareTiers(kps(0.1), kps(0.1), 640, 480)).toBeNull();
  });
});
