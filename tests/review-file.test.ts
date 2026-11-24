import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test';

import type {
  ReviewFile,
  ReviewScreenRef,
  ReviewVariant,
  StripImage,
} from '../plugin/hooks/review-file.ts';
import { writeReviewFile } from '../src/review-file.ts';
import { buildReview, screensOf } from '../src/review.ts';
import type { ShotImages } from '../src/review.ts';
import type {
  Box,
  Shot,
  ShotDiff,
  ShotResult,
  Summary,
  UrlTarget,
} from '../src/types.ts';

type Rgba = [number, number, number, number];

type ImageSet = {
  before?: Buffer;
  after?: Buffer;
  diff?: Buffer;
  unstable?: Buffer;
};

const BLACK: Rgba = [0, 0, 0, 255];
const WHITE: Rgba = [255, 255, 255, 255];

const MAX_STRIP_HEIGHT = 1024;
const MAX_STRIP_BASE64_LENGTH = 100_000;

const HOME: UrlTarget = {
  kind: 'url',
  url: 'http://127.0.0.1:5173/',
  label: 'Home',
};
const ABOUT: UrlTarget = {
  kind: 'url',
  url: 'http://127.0.0.1:5173/about',
  label: 'About',
};
const NEWS: UrlTarget = {
  kind: 'url',
  url: 'http://127.0.0.1:5173/news',
  label: 'News',
};

const BOX: Box = { x: 20, y: 20, width: 10, height: 10 };

function png(
  width: number,
  height: number,
  paint: Array<[Box, Rgba]> = [],
): Buffer {
  const image = new PNG({ width, height });
  image.data.fill(255);
  for (const [
    { x: left, y: top, width: boxWidth, height: boxHeight },
    color,
  ] of paint) {
    for (let y = top; y < top + boxHeight; y++) {
      for (let x = left; x < left + boxWidth; x++) {
        image.data.set(color, (y * width + x) * 4);
      }
    }
  }
  return PNG.sync.write(image);
}

function noise(width: number, height: number, noisyRows = height): Buffer {
  const image = new PNG({ width, height });
  image.data.fill(255);
  let state = 2_463_534_242;
  for (let offset = 0; offset < noisyRows * width * 4; offset += 4) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    image.data.writeInt32LE(state, offset);
  }
  return PNG.sync.write(image);
}

function pixel(image: PNG, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return [...image.data.subarray(offset, offset + 4)];
}

function shot(key: string, target: UrlTarget): Shot {
  return {
    key,
    target,
    viewport: { width: 1280, height: 720 },
    colorScheme: 'light',
  };
}

function capturedFiles(key: string): ShotResult['files'] {
  return { before: `before/${key}.png`, after: `after/${key}.png` };
}

function changed(
  of: Shot,
  regions: Box[],
  {
    unstable,
    dimensions,
  }: { unstable?: Box[]; dimensions?: ShotDiff['dimensions'] } = {},
): ShotResult {
  const diff: ShotDiff = {
    mismatchedPixels: 100,
    mismatchRatio: 0.001,
    bbox: regions[0] ?? null,
    regions,
  };
  if (dimensions !== undefined) diff.dimensions = dimensions;
  const result: ShotResult = {
    shot: of,
    status: 'changed',
    diff,
    warnings: [],
    files: { ...capturedFiles(of.key), diff: `diff/${of.key}.png` },
  };
  if (unstable !== undefined) {
    result.unstable = {
      mismatchRatio: 0.001,
      bbox: unstable[0] ?? null,
      regions: unstable,
    };
    result.files.unstable = `unstable/${of.key}.png`;
  }
  return result;
}

function unchanged(of: Shot): ShotResult {
  return {
    shot: of,
    status: 'unchanged',
    warnings: [],
    files: capturedFiles(of.key),
  };
}

function skipped(
  of: Shot,
  reason: string,
  files: ShotResult['files'],
): ShotResult {
  return {
    shot: of,
    status: 'skipped',
    skipReason: reason,
    warnings: [],
    files,
  };
}

function failed(of: Shot, message: string): ShotResult {
  return {
    shot: of,
    status: 'error',
    error: { phase: 'after', message },
    warnings: [],
    files: { before: `before/${of.key}.png` },
  };
}

function screenRef({ url, label = '' }: UrlTarget): ReviewScreenRef {
  return { key: `url:${url}`, kind: 'url', label, target: url };
}

function variantOf(shotKey: string): ReviewVariant {
  return {
    shotKey,
    viewport: { width: 1280, height: 720 },
    colorScheme: 'light',
    warnings: [],
  };
}

function whole(file: string, width: number, height: number): StripImage {
  return { width, height, strips: [{ file, y: 0, height }] };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ui-compare-review-file-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(
  shots: ShotResult[],
  images: Record<string, ImageSet> = {},
): Promise<ReviewFile> {
  const counts = { changed: 0, unchanged: 0, error: 0, skipped: 0 };
  for (const { status } of shots) counts[status]++;
  const summary: Summary = {
    version: 1,
    id: 'k3x9a2',
    beforeAt: '2026-11-24T09:00:00.000Z',
    afterAt: '2026-11-24T09:10:00.000Z',
    counts,
    shots,
  };
  const shotImages: ShotImages = new Map(Object.entries(images));
  await writeReviewFile(
    dir,
    buildReview(
      summary,
      shotImages,
      screensOf(
        shots.map((result) => result.shot),
        [],
      ),
    ),
    shotImages,
    summary,
  );
  return JSON.parse(
    await readFile(join(dir, 'review.json'), 'utf8'),
  ) as ReviewFile;
}

async function readStrip(file: string): Promise<PNG> {
  return PNG.sync.read(await readFile(join(dir, file)));
}

describe('review.json', () => {
  test('a cropped change carries its crops, the page of its first variant with the crop areas marked, and its diff image', async () => {
    const file = await write([changed(shot('0-home', HOME), [BOX])], {
      '0-home': { before: png(400, 300), after: png(400, 300, [[BOX, BLACK]]) },
    });

    expect(file).toStrictEqual({
      version: 1,
      id: 'k3x9a2',
      beforeAt: '2026-11-24T09:00:00.000Z',
      afterAt: '2026-11-24T09:10:00.000Z',
      errors: [],
      changed: [
        {
          screen: screenRef(HOME),
          changes: [
            {
              variants: [variantOf('0-home')],
              crops: [
                {
                  area: BOX,
                  box: { x: 0, y: 0, width: 320, height: 160 },
                  before: whole('review/0-home-crop-0-before-0.png', 320, 160),
                  after: whole('review/0-home-crop-0-after-0.png', 320, 160),
                },
              ],
              fullPage: false,
              page: {
                before: whole('review/0-home-page-before-0.png', 400, 300),
                after: whole('review/0-home-page-after-0.png', 400, 300),
                marks: [BOX],
              },
              diff: 'diff/0-home.png',
            },
          ],
        },
      ],
      noise: [],
      unchanged: [],
      skipped: [],
    });
  });

  test('the strips hold the crops and pages they stand for', async () => {
    await write([changed(shot('0-home', HOME), [BOX])], {
      '0-home': { before: png(400, 300), after: png(400, 300, [[BOX, BLACK]]) },
    });

    const strips = await Promise.all(
      [
        'review/0-home-crop-0-before-0.png',
        'review/0-home-crop-0-after-0.png',
        'review/0-home-page-before-0.png',
        'review/0-home-page-after-0.png',
      ].map(readStrip),
    );
    expect(strips.map((image) => pixel(image, 25, 25))).toStrictEqual([
      WHITE,
      BLACK,
      WHITE,
      BLACK,
    ]);
  });

  test('a full-page change has no crops, marks the changed areas of its first variant and keeps the page sizes', async () => {
    const regions = [50, 400, 750, 1100, 1450].map((y) => ({
      x: 50,
      y,
      width: 10,
      height: 10,
    }));
    const dimensions: ShotDiff['dimensions'] = {
      before: [800, 1600],
      after: [800, 1700],
    };

    const file = await write(
      [changed(shot('0-home', HOME), regions, { dimensions })],
      { '0-home': { before: png(800, 1600), after: png(800, 1700) } },
    );

    expect(file.changed[0]?.changes).toStrictEqual([
      {
        variants: [variantOf('0-home')],
        crops: [],
        fullPage: true,
        dimensions,
        page: {
          before: whole('review/0-home-page-before-0.png', 800, 1600),
          after: whole('review/0-home-page-after-0.png', 800, 1700),
          marks: regions,
        },
        diff: 'diff/0-home.png',
      },
    ]);
  });

  test('noise, unchanged and skipped lines carry whichever pages their first variant has', async () => {
    const page = png(200, 100);
    const changedPage = png(200, 100, [[BOX, BLACK]]);
    const file = await write(
      [
        changed(
          shot('0-news', NEWS),
          [{ x: 110, y: 50, width: 10, height: 10 }],
          { unstable: [{ x: 100, y: 40, width: 40, height: 30 }] },
        ),
        unchanged(shot('1-about', ABOUT)),
        skipped(shot('2-home', HOME), 'gone in After', {
          before: 'before/2-home.png',
        }),
        skipped(shot('3-home', HOME), 'parameters.vrt.skip', {}),
      ],
      {
        '0-news': {
          before: page,
          after: changedPage,
          diff: page,
          unstable: page,
        },
        '1-about': { before: page, after: changedPage },
        '2-home': { before: page },
      },
    );

    expect({
      noise: file.noise,
      unchanged: file.unchanged,
      skipped: file.skipped,
    }).toStrictEqual({
      noise: [
        {
          screen: screenRef(NEWS),
          variants: [variantOf('0-news')],
          page: {
            before: whole('review/0-news-page-before-0.png', 200, 100),
            after: whole('review/0-news-page-after-0.png', 200, 100),
            unstable: whole('review/0-news-page-unstable-0.png', 200, 100),
            marks: [],
          },
        },
      ],
      unchanged: [
        {
          screen: screenRef(ABOUT),
          variants: [variantOf('1-about')],
          page: {
            before: whole('review/1-about-page-before-0.png', 200, 100),
            after: whole('review/1-about-page-after-0.png', 200, 100),
            marks: [],
          },
        },
      ],
      skipped: [
        {
          screen: screenRef(HOME),
          variants: [variantOf('2-home')],
          reason: 'gone in After',
          page: {
            before: whole('review/2-home-page-before-0.png', 200, 100),
            marks: [],
          },
        },
        {
          screen: screenRef(HOME),
          variants: [variantOf('3-home')],
          reason: 'parameters.vrt.skip',
        },
      ],
    });
  });

  test('a page whose Before and After are the same bytes points both at one set of strips', async () => {
    const file = await write([unchanged(shot('1-about', ABOUT))], {
      '1-about': { before: png(200, 100), after: png(200, 100) },
    });

    expect({
      page: file.unchanged[0]?.page,
      strips: await readdir(join(dir, 'review')),
    }).toStrictEqual({
      page: {
        before: whole('review/1-about-page-before-0.png', 200, 100),
        after: whole('review/1-about-page-before-0.png', 200, 100),
        marks: [],
      },
      strips: ['1-about-page-before-0.png'],
    });
  });

  test('capture errors are carried without pictures', async () => {
    const file = await write([failed(shot('0-home', HOME), 'HTTP 500')], {
      '0-home': { before: png(200, 100) },
    });

    expect(file.errors).toStrictEqual([
      {
        screen: screenRef(HOME),
        variants: [variantOf('0-home')],
        phase: 'after',
        message: 'HTTP 500',
      },
    ]);
  });

  test('only review.json and its strips are left behind', async () => {
    await write(
      [changed(shot('0-home', HOME), [BOX]), unchanged(shot('1-about', ABOUT))],
      {
        '0-home': {
          before: png(400, 300),
          after: png(400, 300, [[BOX, BLACK]]),
        },
        '1-about': { before: png(200, 100), after: png(200, 100) },
      },
    );

    expect({
      run: (await readdir(dir)).toSorted(),
      strips: (await readdir(join(dir, 'review'))).toSorted(),
    }).toStrictEqual({
      run: ['review', 'review.json'],
      strips: [
        '0-home-crop-0-after-0.png',
        '0-home-crop-0-before-0.png',
        '0-home-page-after-0.png',
        '0-home-page-before-0.png',
        '1-about-page-before-0.png',
      ],
    });
  });
});

describe('strips', () => {
  const TALL = { width: 200, height: 1500 };

  async function stripsOf(image: Buffer): Promise<StripImage> {
    const file = await write([unchanged(shot('0-home', HOME))], {
      '0-home': { before: image, after: image },
    });
    const page = file.unchanged[0]?.page?.before;
    if (page === undefined) throw new Error('the line has no Before page');
    return page;
  }

  async function tallNoisyPage(): Promise<{
    image: Buffer;
    page: StripImage;
  }> {
    const image = noise(TALL.width, TALL.height);
    return { image, page: await stripsOf(image) };
  }

  test('a picture too large for one strip is cut into strips of at most 100,000 base64 characters', async () => {
    const { image, page } = await tallNoisyPage();
    const sizes = await Promise.all(
      page.strips.map(async ({ file }) => (await stat(join(dir, file))).size),
    );

    expect({
      wholeFits: Math.ceil(image.length / 3) * 4 <= MAX_STRIP_BASE64_LENGTH,
      cut: page.strips.length > 1,
      stripsFit: sizes.every(
        (size) => Math.ceil(size / 3) * 4 <= MAX_STRIP_BASE64_LENGTH,
      ),
    }).toStrictEqual({ wholeFits: false, cut: true, stripsFit: true });
  });

  test('the strips of a picture cover it exactly, top to bottom', async () => {
    const { image, page } = await tallNoisyPage();
    const strips = await Promise.all(
      page.strips.map(async (strip) => ({
        ...strip,
        image: await readStrip(strip.file),
      })),
    );
    const heights = strips.map(({ height }) => height);

    expect({
      size: [page.width, page.height],
      starts: strips.map(({ y }) => y),
      covered: heights.reduce((sum, height) => sum + height, 0),
      stripSizes: strips.map((strip) => [
        strip.image.width,
        strip.image.height,
      ]),
      pixels: Buffer.concat(strips.map((strip) => strip.image.data)).equals(
        PNG.sync.read(image).data,
      ),
    }).toStrictEqual({
      size: [TALL.width, TALL.height],
      starts: heights.map((_, index) =>
        heights.slice(0, index).reduce((sum, height) => sum + height, 0),
      ),
      covered: TALL.height,
      stripSizes: heights.map((height) => [TALL.width, height]),
      pixels: true,
    });
  });

  test('a picture whose PNG fits one strip is kept whole and byte for byte, however tall it is', async () => {
    const image = png(200, 8000);
    const page = await stripsOf(image);

    expect({
      page,
      bytes: (
        await readFile(join(dir, 'review/0-home-page-before-0.png'))
      ).equals(image),
    }).toStrictEqual({
      page: whole('review/0-home-page-before-0.png', 200, 8000),
      bytes: true,
    });
  });

  test('flat content below a busy band goes back to strips of the maximum height', async () => {
    const { strips } = await stripsOf(noise(200, 8000, 300));
    const heights = strips.map(({ height }) => height);

    expect({
      few: heights.length <= 16,
      lastWhole: heights.slice(-4, -1),
    }).toStrictEqual({
      few: true,
      lastWhole: [MAX_STRIP_HEIGHT, MAX_STRIP_HEIGHT, MAX_STRIP_HEIGHT],
    });
  });

  test('a picture with a row too large for any strip throws, naming the shot, and writes no review.json', async () => {
    const wide = noise(23_000, 1);

    await expect(
      write([unchanged(shot('0-wide', HOME))], {
        '0-wide': { before: wide, after: wide },
      }),
    ).rejects.toThrow('shot 0-wide');
    expect(existsSync(join(dir, 'review.json'))).toBe(false);
  });
});
