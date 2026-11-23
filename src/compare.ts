import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import type { Box, ShotDiff } from './types.ts';

export type ComparePngsResult = {
  passed: boolean;
  diffPng: Buffer | null;
} & ShotDiff;

const DIFF_COLOR: [number, number, number] = [255, 0, 0];

function pad(source: PNG, width: number, height: number): PNG {
  if (source.width === width && source.height === height) return source;
  const padded = new PNG({ width, height });
  PNG.bitblt(source, padded, 0, 0, source.width, source.height, 0, 0);
  return padded;
}

export function comparePngs(
  before: Buffer,
  after: Buffer,
  { threshold = 0.1 }: { threshold?: number } = {},
): ComparePngsResult {
  if (before.equals(after)) {
    return {
      passed: true,
      diffPng: null,
      mismatchedPixels: 0,
      mismatchRatio: 0,
      bbox: null,
    };
  }

  const beforeImage = PNG.sync.read(before);
  const afterImage = PNG.sync.read(after);
  const sameSize =
    beforeImage.width === afterImage.width &&
    beforeImage.height === afterImage.height;
  const width = Math.max(beforeImage.width, afterImage.width);
  const height = Math.max(beforeImage.height, afterImage.height);
  const diff = new PNG({ width, height });

  const mismatchedPixels = pixelmatch(
    pad(beforeImage, width, height).data,
    pad(afterImage, width, height).data,
    diff.data,
    width,
    height,
    {
      threshold,
      includeAA: false,
      alpha: 0.5,
      diffColor: DIFF_COLOR,
      diffColorAlt: DIFF_COLOR,
    },
  );

  if (sameSize && mismatchedPixels === 0) {
    return {
      passed: true,
      diffPng: null,
      mismatchedPixels: 0,
      mismatchRatio: 0,
      bbox: null,
    };
  }

  const result: ComparePngsResult = {
    passed: false,
    diffPng: PNG.sync.write(diff),
    mismatchedPixels,
    mismatchRatio: mismatchedPixels / (width * height),
    bbox: mismatchBox(diff),
  };
  if (!sameSize) {
    result.dimensions = {
      before: [beforeImage.width, beforeImage.height],
      after: [afterImage.width, afterImage.height],
    };
  }
  return result;
}

export function mismatchBox(diff: {
  width: number;
  height: number;
  data: Uint8Array;
}): Box | null {
  // pixelmatch paints unchanged pixels gray (r = g = b) and ignored anti-aliased
  // pixels in aaColor (yellow), so pure red marks exactly the counted mismatches.
  const [red, green, blue] = DIFF_COLOR;
  const { width, height, data } = diff;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (
        data[offset] === red &&
        data[offset + 1] === green &&
        data[offset + 2] === blue &&
        data[offset + 3] === 255
      ) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
