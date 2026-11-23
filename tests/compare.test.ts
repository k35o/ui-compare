import { PNG } from 'pngjs';
import type { PackerOptions } from 'pngjs';
import { assert, describe, expect, test } from 'vite-plus/test';

import { comparePngs, mismatchBox } from '../src/compare.ts';
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
