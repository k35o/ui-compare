import { PNG } from 'pngjs';
import type { PackerOptions } from 'pngjs';
import { assert, describe, expect, test } from 'vite-plus/test';

import { comparePngs, mismatchBox, mismatchRegions } from '../src/compare.ts';
import type { Box } from '../src/types.ts';

type Rgba = [number, number, number, number];

const WHITE: Rgba = [255, 255, 255, 255];
const BLACK: Rgba = [0, 0, 0, 255];
const RED: Rgba = [255, 0, 0, 255];
const YELLOW: Rgba = [255, 255, 0, 255];
const GRAY: Rgba = [128, 128, 128, 255];

function fill(png: PNG, box: Box, color: Rgba): PNG {
  const { x: left, y: top, width, height } = box;
  for (let y = top; y < top + height; y++) {
    for (let x = left; x < left + width; x++) {
      png.data.set(color, (y * png.width + x) * 4);
    }
  }
  return png;
}

function image(width: number, height: number, background: Rgba): PNG {
  return fill(
    new PNG({ width, height }),
    { x: 0, y: 0, width, height },
    background,
  );
}

function encode(png: PNG, options?: PackerOptions): Buffer {
  return PNG.sync.write(png, options);
}

describe('comparePngs', () => {
  test('byte-identical PNGs pass without a diff image', () => {
    const png = encode(image(4, 4, WHITE));

    expect(comparePngs(png, Buffer.from(png))).toStrictEqual({
      passed: true,
      diffPng: null,
      mismatchedPixels: 0,
      mismatchRatio: 0,
      bbox: null,
      regions: [],
    });
  });

  test('the same pixels encoded into different bytes pass', () => {
    const pixels = fill(
      image(8, 8, WHITE),
      { x: 4, y: 0, width: 4, height: 8 },
      BLACK,
    );
    const before = encode(pixels, { deflateLevel: 0 });
    const after = encode(pixels, { deflateLevel: 9 });
    expect(before.equals(after)).toBe(false);

    expect(comparePngs(before, after)).toStrictEqual({
      passed: true,
      diffPng: null,
      mismatchedPixels: 0,
      mismatchRatio: 0,
      bbox: null,
      regions: [],
    });
  });

  test('a changed rectangle is reported with its bounding box and pixel count', () => {
    const before = encode(image(20, 20, WHITE));
    const after = encode(
      fill(image(20, 20, WHITE), { x: 5, y: 3, width: 5, height: 4 }, BLACK),
    );

    const result = comparePngs(before, after);

    expect(result.passed).toBe(false);
    expect(result.mismatchedPixels).toBe(20);
    expect(result.mismatchRatio).toBe(0.05);
    expect(result.bbox).toStrictEqual({ x: 5, y: 3, width: 5, height: 4 });
    expect(result).not.toHaveProperty('dimensions');
  });

  test('a taller After reports both sizes and a bbox over the grown area', () => {
    const before = encode(image(10, 10, WHITE));
    const after = encode(image(10, 14, WHITE));

    const result = comparePngs(before, after);

    expect(result.passed).toBe(false);
    expect(result.dimensions).toStrictEqual({
      before: [10, 10],
      after: [10, 14],
    });
    expect(result.bbox).toStrictEqual({ x: 0, y: 10, width: 10, height: 4 });
  });

  test('a size change whose added area matches has no regions but reports both sizes', () => {
    const before = encode(new PNG({ width: 10, height: 10 }));
    const after = encode(new PNG({ width: 10, height: 14 }));

    expect(comparePngs(before, after)).toStrictEqual({
      passed: false,
      diffPng: expect.any(Buffer),
      mismatchedPixels: 0,
      mismatchRatio: 0,
      bbox: null,
      regions: [],
      dimensions: { before: [10, 10], after: [10, 14] },
    });
  });

  test('separate changed areas are reported as regions inside a bbox spanning both', () => {
    const before = encode(image(200, 200, WHITE));
    const changed = image(200, 200, WHITE);
    fill(changed, { x: 10, y: 10, width: 20, height: 10 }, BLACK);
    fill(changed, { x: 150, y: 120, width: 30, height: 40 }, BLACK);

    const result = comparePngs(before, encode(changed));

    expect(result.regions).toStrictEqual([
      { x: 10, y: 10, width: 20, height: 10 },
      { x: 150, y: 120, width: 30, height: 40 },
    ]);
    expect(result.bbox).toStrictEqual({
      x: 10,
      y: 10,
      width: 170,
      height: 150,
    });
  });

  test('the diff image covers the larger width and the larger height', () => {
    const before = encode(image(10, 10, WHITE));
    const after = encode(image(14, 8, WHITE));

    const { diffPng } = comparePngs(before, after);
    assert.isNotNull(diffPng);
    const decoded = PNG.sync.read(diffPng);

    expect([decoded.width, decoded.height]).toStrictEqual([14, 10]);
  });
});

describe('mismatchBox', () => {
  test('spans the outermost red pixels', () => {
    const diff = image(10, 10, GRAY);
    fill(diff, { x: 2, y: 7, width: 1, height: 1 }, RED);
    fill(diff, { x: 6, y: 1, width: 1, height: 1 }, RED);

    expect(mismatchBox(diff)).toStrictEqual({
      x: 2,
      y: 1,
      width: 5,
      height: 7,
    });
  });

  test('returns null when only gray and anti-aliasing yellow pixels are present', () => {
    const diff = fill(
      image(6, 6, GRAY),
      { x: 0, y: 0, width: 3, height: 6 },
      YELLOW,
    );

    expect(mismatchBox(diff)).toBeNull();
  });
});

describe('mismatchRegions', () => {
  test('far-apart marks are separate regions ordered top to bottom', () => {
    const diff = image(300, 300, GRAY);
    fill(diff, { x: 200, y: 20, width: 40, height: 10 }, RED);
    fill(diff, { x: 10, y: 220, width: 30, height: 20 }, RED);

    expect(mismatchRegions(diff)).toStrictEqual([
      { x: 200, y: 20, width: 40, height: 10 },
      { x: 10, y: 220, width: 30, height: 20 },
    ]);
  });

  test.each([
    { apart: 20, regions: [{ x: 10, y: 10, width: 60, height: 10 }] },
    { apart: 31, regions: [{ x: 10, y: 10, width: 71, height: 10 }] },
  ])('marks $apart px apart form one region', ({ apart, regions }) => {
    const diff = image(160, 40, GRAY);
    fill(diff, { x: 10, y: 10, width: 20, height: 10 }, RED);
    fill(diff, { x: 30 + apart, y: 10, width: 20, height: 10 }, RED);

    expect(mismatchRegions(diff)).toStrictEqual(regions);
  });

  test.each([
    {
      apart: 32,
      regions: [
        { x: 10, y: 10, width: 20, height: 10 },
        { x: 62, y: 10, width: 20, height: 10 },
      ],
    },
    {
      apart: 40,
      regions: [
        { x: 10, y: 10, width: 20, height: 10 },
        { x: 70, y: 10, width: 20, height: 10 },
      ],
    },
  ])('marks $apart px apart form two regions', ({ apart, regions }) => {
    const diff = image(160, 40, GRAY);
    fill(diff, { x: 10, y: 10, width: 20, height: 10 }, RED);
    fill(diff, { x: 30 + apart, y: 10, width: 20, height: 10 }, RED);

    expect(mismatchRegions(diff)).toStrictEqual(regions);
  });

  test('a diagonal chain of marks within the gap of each other forms one region', () => {
    const diff = image(120, 120, GRAY);
    for (const step of [0, 25, 50, 75, 100]) {
      fill(diff, { x: step, y: step, width: 2, height: 2 }, RED);
    }

    expect(mismatchRegions(diff)).toStrictEqual([
      { x: 0, y: 0, width: 102, height: 102 },
    ]);
  });

  test('a mark near the merged box of other marks joins it although it is far from each of them', () => {
    const diff = image(160, 120, GRAY);
    fill(diff, { x: 0, y: 0, width: 10, height: 100 }, RED);
    fill(diff, { x: 0, y: 90, width: 100, height: 10 }, RED);
    fill(diff, { x: 120, y: 0, width: 10, height: 10 }, RED);

    expect(mismatchRegions(diff)).toStrictEqual([
      { x: 0, y: 0, width: 130, height: 100 },
    ]);
  });

  test('a 1280x6000 diff with scattered marks is split well within a second', () => {
    const diff = new PNG({ width: 1280, height: 6000 });
    for (let y = 0; y < 6000; y += 64) {
      for (let x = 0; x < 1280; x += 64) {
        fill(diff, { x, y, width: 3, height: 3 }, RED);
      }
    }

    const started = performance.now();
    const regions = mismatchRegions(diff);
    const elapsed = performance.now() - started;

    expect(regions).toHaveLength(1880);
    expect(elapsed).toBeLessThan(2000);
  });
});
