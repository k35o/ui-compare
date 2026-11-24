import { PNG } from 'pngjs';
import { describe, expect, test } from 'vite-plus/test';

import { buildReview } from '../src/review.ts';
import type { Crop, ListEntry, Review } from '../src/review.ts';
import type {
  Box,
  ColorScheme,
  Shot,
  ShotDiff,
  ShotResult,
  Summary,
  Target,
  Viewport,
} from '../src/types.ts';

type Rgba = [number, number, number, number];

const BLACK: Rgba = [0, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];

const DESKTOP: Viewport = { width: 1280, height: 720 };
const MOBILE: Viewport = { width: 375, height: 812 };

const HOME: Target = { kind: 'url', url: 'http://127.0.0.1:5173/' };
const ABOUT: Target = { kind: 'url', url: 'http://127.0.0.1:5173/about' };

function story(title: string, name: string, storyId: string): Target {
  return {
    kind: 'story',
    url: `http://127.0.0.1:6006/iframe.html?id=${storyId}&viewMode=story`,
    storyId,
    title,
    name,
    importPath: './src/stories.tsx',
  };
}

const BUTTON_PRIMARY = story(
  'Components/Button',
  'Primary',
  'components-button--primary',
);
const BUTTON_SECONDARY = story(
  'Components/Button',
  'Secondary',
  'components-button--secondary',
);
const CARD_DEFAULT = story(
  'Components/Card',
  'Default',
  'components-card--default',
);

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

function pixel(image: Buffer, x: number, y: number): number[] {
  const { width, data } = PNG.sync.read(image);
  const offset = (y * width + x) * 4;
  return [...data.subarray(offset, offset + 4)];
}

function size(image: Buffer): [width: number, height: number] {
  const { width, height } = PNG.sync.read(image);
  return [width, height];
}

const BOX: Box = { x: 20, y: 20, width: 10, height: 10 };
const PAGE = png(400, 300);
const PAGE_WITH_BLACK_BOX = png(400, 300, [[BOX, BLACK]]);
const PAGE_WITH_BLUE_BOX = png(400, 300, [[BOX, BLUE]]);
const TALL_PAGE = png(400, 340);
const LARGE_PAGE = png(800, 600);

function shot(
  key: string,
  target: Target,
  viewport: Viewport = DESKTOP,
  colorScheme: ColorScheme = 'light',
): Shot {
  return { key, target, viewport, colorScheme };
}

function unchanged(of: Shot, warnings: string[] = []): ShotResult {
  return { shot: of, status: 'unchanged', warnings, files: {} };
}

function skipped(of: Shot, reason: string): ShotResult {
  return {
    shot: of,
    status: 'skipped',
    skipReason: reason,
    warnings: [],
    files: {},
  };
}

function failed(
  of: Shot,
  phase: 'before' | 'after',
  message: string,
): ShotResult {
  return {
    shot: of,
    status: 'error',
    error: { phase, message },
    warnings: [],
    files: {},
  };
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
    files: {},
  };
  if (unstable !== undefined) {
    result.unstable = {
      mismatchRatio: 0.001,
      bbox: unstable[0] ?? null,
      regions: unstable,
    };
  }
  return result;
}

function review(
  shots: ShotResult[],
  images: Record<string, [before: Buffer, after: Buffer]> = {},
): Review {
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
  return buildReview(
    summary,
    new Map(
      Object.entries(images).map(([key, [before, after]]) => [
        key,
        { before, after },
      ]),
    ),
  );
}

function listOutline(
  entries: ListEntry[],
): Array<{ screen: string; variants: string[] }> {
  return entries.map(({ screen, variants }) => ({
    screen: screen.key,
    variants: variants.map(({ shotKey }) => shotKey),
  }));
}

function errorOutline(result: Review): Array<{
  screen: string;
  phase: 'before' | 'after';
  message: string;
  variants: string[];
}> {
  return result.errors.map(({ screen, phase, message, variants }) => ({
    screen: screen.key,
    phase,
    message,
    variants: variants.map(({ shotKey }) => shotKey),
  }));
}

function changeOutline(
  result: Review,
): Array<{ screen: string; changes: string[][] }> {
  return result.changed.map(({ screen, changes }) => ({
    screen: screen.key,
    changes: changes.map(({ variants }) =>
      variants.map(({ shotKey }) => shotKey),
    ),
  }));
}

function onlyChange(result: Review) {
  const [screen, ...otherScreens] = result.changed;
  const [change, ...otherChanges] = screen?.changes ?? [];
  if (change === undefined || otherScreens.length + otherChanges.length > 0) {
    throw new Error('expected exactly one change');
  }
  return change;
}

function cropBoxes(result: Review): Box[] {
  return onlyChange(result).crops.map(({ box }) => box);
}

function onlyCrop(result: Review): Crop {
  const [crop, ...others] = onlyChange(result).crops;
  if (crop === undefined || others.length > 0) {
    throw new Error('expected exactly one crop');
  }
  return crop;
}

test('a run without shots has an empty review', () => {
  expect(review([])).toStrictEqual({
    id: 'k3x9a2',
    beforeAt: '2026-11-24T09:00:00.000Z',
    afterAt: '2026-11-24T09:10:00.000Z',
    errors: [],
    changed: [],
    noise: [],
    unchanged: [],
    skipped: [],
  });
});

describe('screens', () => {
  test('shots of one URL form one screen with a variant per shot', () => {
    const result = review([
      unchanged(shot('0-home', HOME)),
      unchanged(shot('1-home', HOME, MOBILE, 'dark'), [
        'The page did not settle; captured the last frame',
      ]),
      unchanged(shot('2-about', ABOUT)),
    ]);

    expect(result.unchanged).toStrictEqual([
      {
        screen: {
          key: 'url:http://127.0.0.1:5173/',
          kind: 'url',
          label: 'http://127.0.0.1:5173/',
        },
        variants: [
          {
            shotKey: '0-home',
            viewport: { width: 1280, height: 720 },
            colorScheme: 'light',
            warnings: [],
          },
          {
            shotKey: '1-home',
            viewport: { width: 375, height: 812 },
            colorScheme: 'dark',
            warnings: ['The page did not settle; captured the last frame'],
          },
        ],
      },
      {
        screen: {
          key: 'url:http://127.0.0.1:5173/about',
          kind: 'url',
          label: 'http://127.0.0.1:5173/about',
        },
        variants: [
          {
            shotKey: '2-about',
            viewport: { width: 1280, height: 720 },
            colorScheme: 'light',
            warnings: [],
          },
        ],
      },
    ]);
  });

  test('stories with the same title form one component screen', () => {
    const result = review([
      unchanged(shot('0-button-primary', BUTTON_PRIMARY)),
      unchanged(shot('1-card-default', CARD_DEFAULT)),
      unchanged(shot('2-button-secondary', BUTTON_SECONDARY)),
    ]);

    expect(result.unchanged).toStrictEqual([
      {
        screen: {
          key: 'component:Components/Button',
          kind: 'component',
          label: 'Components/Button',
        },
        variants: [
          {
            shotKey: '0-button-primary',
            viewport: { width: 1280, height: 720 },
            colorScheme: 'light',
            story: 'Primary',
            warnings: [],
          },
          {
            shotKey: '2-button-secondary',
            viewport: { width: 1280, height: 720 },
            colorScheme: 'light',
            story: 'Secondary',
            warnings: [],
          },
        ],
      },
      {
        screen: {
          key: 'component:Components/Card',
          kind: 'component',
          label: 'Components/Card',
        },
        variants: [
          {
            shotKey: '1-card-default',
            viewport: { width: 1280, height: 720 },
            colorScheme: 'light',
            story: 'Default',
            warnings: [],
          },
        ],
      },
    ]);
  });
});

describe('errors and skipped shots', () => {
  test('the same error of one screen at several settings is listed once', () => {
    const result = review([
      failed(shot('0-home', HOME), 'before', 'HTTP 404 from the page'),
      failed(shot('1-home', HOME, MOBILE), 'before', 'HTTP 404 from the page'),
    ]);

    expect(result.errors).toStrictEqual([
      {
        screen: {
          key: 'url:http://127.0.0.1:5173/',
          kind: 'url',
          label: 'http://127.0.0.1:5173/',
        },
        variants: [
          {
            shotKey: '0-home',
            viewport: { width: 1280, height: 720 },
            colorScheme: 'light',
            warnings: [],
          },
          {
            shotKey: '1-home',
            viewport: { width: 375, height: 812 },
            colorScheme: 'light',
            warnings: [],
          },
        ],
        phase: 'before',
        message: 'HTTP 404 from the page',
      },
    ]);
  });

  test('the same error of one screen in Before and in After is listed once per phase', () => {
    const result = review([
      failed(shot('0-home', HOME), 'before', 'HTTP 500 from the page'),
      unchanged(shot('1-about', ABOUT)),
      failed(shot('2-home', HOME, MOBILE), 'after', 'HTTP 500 from the page'),
    ]);

    expect(errorOutline(result)).toStrictEqual([
      {
        screen: 'url:http://127.0.0.1:5173/',
        phase: 'before',
        message: 'HTTP 500 from the page',
        variants: ['0-home'],
      },
      {
        screen: 'url:http://127.0.0.1:5173/',
        phase: 'after',
        message: 'HTTP 500 from the page',
        variants: ['2-home'],
      },
    ]);
  });

  test('different errors of one screen in the same phase are listed separately', () => {
    const result = review([
      failed(shot('0-home', HOME), 'after', 'HTTP 500 from the page'),
      failed(
        shot('1-home', HOME, MOBILE),
        'after',
        'The page stopped responding',
      ),
    ]);

    expect(errorOutline(result)).toStrictEqual([
      {
        screen: 'url:http://127.0.0.1:5173/',
        phase: 'after',
        message: 'HTTP 500 from the page',
        variants: ['0-home'],
      },
      {
        screen: 'url:http://127.0.0.1:5173/',
        phase: 'after',
        message: 'The page stopped responding',
        variants: ['1-home'],
      },
    ]);
  });

  test('the same error on two screens is listed under each screen', () => {
    const result = review([
      failed(shot('0-home', HOME), 'before', 'HTTP 404 from the page'),
      failed(shot('1-about', ABOUT), 'before', 'HTTP 404 from the page'),
    ]);

    expect(errorOutline(result)).toStrictEqual([
      {
        screen: 'url:http://127.0.0.1:5173/',
        phase: 'before',
        message: 'HTTP 404 from the page',
        variants: ['0-home'],
      },
      {
        screen: 'url:http://127.0.0.1:5173/about',
        phase: 'before',
        message: 'HTTP 404 from the page',
        variants: ['1-about'],
      },
    ]);
  });

  test('skipped shots are grouped per screen and reason', () => {
    const result = review([
      skipped(shot('0-button-primary', BUTTON_PRIMARY), 'parameters.vrt.skip'),
      skipped(shot('1-button-secondary', BUTTON_SECONDARY), 'not in Storybook'),
      skipped(
        shot('2-button-primary', BUTTON_PRIMARY, MOBILE),
        'parameters.vrt.skip',
      ),
    ]);

    expect(
      result.skipped.map(({ screen, variants, reason }) => ({
        screen: screen.key,
        variants: variants.map(({ shotKey }) => shotKey),
        reason,
      })),
    ).toStrictEqual([
      {
        screen: 'component:Components/Button',
        variants: ['0-button-primary', '2-button-primary'],
        reason: 'parameters.vrt.skip',
      },
      {
        screen: 'component:Components/Button',
        variants: ['1-button-secondary'],
        reason: 'not in Storybook',
      },
    ]);
  });
});

describe('noise', () => {
  const UNSTABLE: Box = { x: 100, y: 100, width: 50, height: 20 };

  test('a change inside an area that was unstable in Before is noise', () => {
    const result = review(
      [
        changed(
          shot('0-home', HOME),
          [{ x: 110, y: 105, width: 10, height: 10 }],
          { unstable: [UNSTABLE] },
        ),
      ],
      { '0-home': [PAGE, PAGE] },
    );

    expect([listOutline(result.noise), result.changed]).toStrictEqual([
      [{ screen: 'url:http://127.0.0.1:5173/', variants: ['0-home'] }],
      [],
    ]);
  });

  test('noise shots of one screen are listed together', () => {
    const inside = [{ x: 110, y: 105, width: 10, height: 10 }];
    const result = review(
      [
        changed(shot('0-home', HOME), inside, { unstable: [UNSTABLE] }),
        changed(shot('1-about', ABOUT), inside, { unstable: [UNSTABLE] }),
        changed(shot('2-home', HOME, MOBILE), inside, { unstable: [UNSTABLE] }),
      ],
      {
        '0-home': [PAGE, PAGE],
        '1-about': [PAGE, PAGE],
        '2-home': [PAGE, PAGE],
      },
    );

    expect(listOutline(result.noise)).toStrictEqual([
      { screen: 'url:http://127.0.0.1:5173/', variants: ['0-home', '2-home'] },
      { screen: 'url:http://127.0.0.1:5173/about', variants: ['1-about'] },
    ]);
  });

  test('a change 15 px from an unstable area is noise', () => {
    const result = review(
      [
        changed(
          shot('0-home', HOME),
          [{ x: 165, y: 105, width: 10, height: 10 }],
          { unstable: [UNSTABLE] },
        ),
      ],
      { '0-home': [PAGE, PAGE] },
    );

    expect([listOutline(result.noise), result.changed]).toStrictEqual([
      [{ screen: 'url:http://127.0.0.1:5173/', variants: ['0-home'] }],
      [],
    ]);
  });

  test('a change 16 px from an unstable area is a real change', () => {
    const result = review(
      [
        changed(
          shot('0-home', HOME),
          [{ x: 166, y: 105, width: 10, height: 10 }],
          { unstable: [UNSTABLE] },
        ),
      ],
      { '0-home': [PAGE, PAGE] },
    );

    expect([result.noise, changeOutline(result)]).toStrictEqual([
      [],
      [{ screen: 'url:http://127.0.0.1:5173/', changes: [['0-home']] }],
    ]);
  });

  test('a change with one area outside the unstable area is a real change', () => {
    const result = review(
      [
        changed(
          shot('0-home', HOME),
          [
            { x: 110, y: 105, width: 10, height: 10 },
            { x: 300, y: 250, width: 10, height: 10 },
          ],
          { unstable: [UNSTABLE] },
        ),
      ],
      { '0-home': [PAGE, PAGE] },
    );

    expect([result.noise, changeOutline(result)]).toStrictEqual([
      [],
      [{ screen: 'url:http://127.0.0.1:5173/', changes: [['0-home']] }],
    ]);
  });

  test('a size-only change of an unstable shot is a real change', () => {
    const result = review(
      [changed(shot('0-home', HOME), [], { unstable: [UNSTABLE] })],
      {
        '0-home': [PAGE, TALL_PAGE],
      },
    );

    expect([result.noise, changeOutline(result)]).toStrictEqual([
      [],
      [{ screen: 'url:http://127.0.0.1:5173/', changes: [['0-home']] }],
    ]);
  });
});

describe('same change', () => {
  test('the same change at two viewports is shown once with both variants', () => {
    const result = review(
      [
        changed(shot('0-home', HOME), [BOX]),
        changed(shot('1-home', HOME, MOBILE), [BOX]),
      ],
      {
        '0-home': [png(500, 300), png(500, 300, [[BOX, BLACK]])],
        '1-home': [PAGE, PAGE_WITH_BLACK_BOX],
      },
    );

    expect(changeOutline(result)).toStrictEqual([
      { screen: 'url:http://127.0.0.1:5173/', changes: [['0-home', '1-home']] },
    ]);
  });

  test('the same change in two stories of a component is shown once', () => {
    const result = review(
      [
        changed(shot('0-button-primary', BUTTON_PRIMARY), [BOX]),
        changed(shot('1-button-secondary', BUTTON_SECONDARY), [BOX]),
      ],
      {
        '0-button-primary': [PAGE, PAGE_WITH_BLACK_BOX],
        '1-button-secondary': [PAGE, PAGE_WITH_BLACK_BOX],
      },
    );

    expect(changeOutline(result)).toStrictEqual([
      {
        screen: 'component:Components/Button',
        changes: [['0-button-primary', '1-button-secondary']],
      },
    ]);
  });

  test('different crops on one screen are separate changes', () => {
    const result = review(
      [
        changed(shot('0-home', HOME), [BOX]),
        changed(shot('1-home', HOME, MOBILE), [BOX]),
      ],
      {
        '0-home': [PAGE, PAGE_WITH_BLACK_BOX],
        '1-home': [PAGE, PAGE_WITH_BLUE_BOX],
      },
    );

    expect(changeOutline(result)).toStrictEqual([
      {
        screen: 'url:http://127.0.0.1:5173/',
        changes: [['0-home'], ['1-home']],
      },
    ]);
  });

  test('the same After from different Befores are separate changes', () => {
    const result = review(
      [
        changed(shot('0-home', HOME), [BOX]),
        changed(shot('1-home', HOME, MOBILE), [BOX]),
      ],
      {
        '0-home': [PAGE, PAGE_WITH_BLACK_BOX],
        '1-home': [PAGE_WITH_BLUE_BOX, PAGE_WITH_BLACK_BOX],
      },
    );

    expect(changeOutline(result)).toStrictEqual([
      {
        screen: 'url:http://127.0.0.1:5173/',
        changes: [['0-home'], ['1-home']],
      },
    ]);
  });

  test('the same change on two screens is shown under each screen', () => {
    const result = review(
      [
        changed(shot('0-home', HOME), [BOX]),
        changed(shot('1-about', ABOUT), [BOX]),
      ],
      {
        '0-home': [PAGE, PAGE_WITH_BLACK_BOX],
        '1-about': [PAGE, PAGE_WITH_BLACK_BOX],
      },
    );

    expect(changeOutline(result)).toStrictEqual([
      { screen: 'url:http://127.0.0.1:5173/', changes: [['0-home']] },
      { screen: 'url:http://127.0.0.1:5173/about', changes: [['1-about']] },
    ]);
  });

  test('full-page changes are never merged', () => {
    const result = review(
      [
        changed(shot('0-home', HOME), []),
        changed(shot('1-home', HOME, MOBILE), []),
      ],
      { '0-home': [PAGE, TALL_PAGE], '1-home': [PAGE, TALL_PAGE] },
    );

    expect(changeOutline(result)).toStrictEqual([
      {
        screen: 'url:http://127.0.0.1:5173/',
        changes: [['0-home'], ['1-home']],
      },
    ]);
  });
});

describe('full page', () => {
  test('five areas show the full page instead of crops', () => {
    const regions = [50, 400, 750, 1100, 1450].map((y) => ({
      x: 50,
      y,
      width: 10,
      height: 10,
    }));
    const tallPage = png(800, 1600);
    const result = review([changed(shot('0-home', HOME), regions)], {
      '0-home': [tallPage, tallPage],
    });

    expect(onlyChange(result)).toStrictEqual({
      variants: [
        {
          shotKey: '0-home',
          viewport: { width: 1280, height: 720 },
          colorScheme: 'light',
          warnings: [],
        },
      ],
      crops: [],
      fullPage: true,
    });
  });

  test('four areas are cropped separately', () => {
    const regions = [
      { x: 50, y: 50, width: 10, height: 10 },
      { x: 600, y: 50, width: 10, height: 10 },
      { x: 50, y: 500, width: 10, height: 10 },
      { x: 600, y: 500, width: 10, height: 10 },
    ];
    const result = review([changed(shot('0-home', HOME), regions)], {
      '0-home': [LARGE_PAGE, LARGE_PAGE],
    });

    expect(cropBoxes(result)).toStrictEqual([
      { x: 0, y: 0, width: 320, height: 160 },
      { x: 445, y: 0, width: 320, height: 160 },
      { x: 0, y: 425, width: 320, height: 160 },
      { x: 445, y: 425, width: 320, height: 160 },
    ]);
  });

  test('areas covering more than half of the page show the full page', () => {
    const result = review(
      [
        changed(shot('0-home', HOME), [
          { x: 0, y: 0, width: 300, height: 201 },
        ]),
      ],
      { '0-home': [PAGE, PAGE] },
    );

    expect([
      onlyChange(result).fullPage,
      onlyChange(result).crops,
    ]).toStrictEqual([true, []]);
  });

  test('areas covering exactly half of the larger image are cropped', () => {
    const result = review(
      [
        changed(shot('0-home', HOME), [
          { x: 0, y: 0, width: 300, height: 200 },
        ]),
      ],
      { '0-home': [png(400, 200), PAGE] },
    );

    expect(cropBoxes(result)).toStrictEqual([
      { x: 0, y: 0, width: 396, height: 296 },
    ]);
  });

  test('a size-only change shows the full page', () => {
    const result = review([changed(shot('0-home', HOME), [])], {
      '0-home': [PAGE, TALL_PAGE],
    });

    expect([
      onlyChange(result).fullPage,
      onlyChange(result).crops,
    ]).toStrictEqual([true, []]);
  });
});

describe('page size', () => {
  test('a change of page size carries the Before and After sizes', () => {
    const result = review(
      [
        changed(shot('0-home', HOME), [], {
          dimensions: { before: [400, 300], after: [400, 340] },
        }),
      ],
      { '0-home': [PAGE, TALL_PAGE] },
    );

    expect(onlyChange(result)).toStrictEqual({
      variants: [
        {
          shotKey: '0-home',
          viewport: { width: 1280, height: 720 },
          colorScheme: 'light',
          warnings: [],
        },
      ],
      crops: [],
      fullPage: true,
      dimensions: { before: [400, 300], after: [400, 340] },
    });
  });

  test('a change at the same page size has no sizes', () => {
    const result = review([changed(shot('0-home', HOME), [BOX])], {
      '0-home': [PAGE, PAGE_WITH_BLACK_BOX],
    });

    expect(onlyChange(result)).not.toHaveProperty('dimensions');
  });

  test('the same change at two page sizes keeps the sizes of its first variant', () => {
    const result = review(
      [
        changed(shot('0-home', HOME), [BOX], {
          dimensions: { before: [400, 300], after: [400, 340] },
        }),
        changed(shot('1-home', HOME, MOBILE), [BOX], {
          dimensions: { before: [400, 300], after: [400, 360] },
        }),
      ],
      {
        '0-home': [PAGE, png(400, 340, [[BOX, BLACK]])],
        '1-home': [PAGE, png(400, 360, [[BOX, BLACK]])],
      },
    );
    const { variants, dimensions } = onlyChange(result);

    expect({
      variants: variants.map(({ shotKey }) => shotKey),
      dimensions,
    }).toStrictEqual({
      variants: ['0-home', '1-home'],
      dimensions: { before: [400, 300], after: [400, 340] },
    });
  });
});

describe('crops', () => {
  test('a small area gets a 48 px margin and is widened to 320×160 around its centre', () => {
    const result = review(
      [
        changed(shot('0-home', HOME), [
          { x: 400, y: 300, width: 20, height: 10 },
        ]),
      ],
      { '0-home': [LARGE_PAGE, LARGE_PAGE] },
    );

    expect(cropBoxes(result)).toStrictEqual([
      { x: 250, y: 225, width: 320, height: 160 },
    ]);
  });

  test('areas whose crops overlap, like two corners of one element, share one crop', () => {
    const result = review(
      [
        changed(shot('0-home', HOME), [
          { x: 300, y: 300, width: 14, height: 40 },
          { x: 392, y: 300, width: 14, height: 40 },
        ]),
      ],
      { '0-home': [LARGE_PAGE, LARGE_PAGE] },
    );

    expect(
      onlyChange(result).crops.map(({ area, box }) => ({ area, box })),
    ).toStrictEqual([
      {
        area: { x: 300, y: 300, width: 106, height: 40 },
        box: { x: 147, y: 240, width: 412, height: 160 },
      },
    ]);
  });

  test('a large area gets only a 48 px margin', () => {
    const result = review(
      [
        changed(shot('0-home', HOME), [
          { x: 100, y: 100, width: 400, height: 200 },
        ]),
      ],
      { '0-home': [LARGE_PAGE, LARGE_PAGE] },
    );

    expect(cropBoxes(result)).toStrictEqual([
      { x: 52, y: 52, width: 496, height: 296 },
    ]);
  });

  test('a crop at the top-left corner is moved inside the page', () => {
    const result = review(
      [changed(shot('0-home', HOME), [{ x: 5, y: 5, width: 10, height: 10 }])],
      { '0-home': [LARGE_PAGE, LARGE_PAGE] },
    );

    expect(cropBoxes(result)).toStrictEqual([
      { x: 0, y: 0, width: 320, height: 160 },
    ]);
  });

  test('a crop at the bottom-right corner is moved inside the page', () => {
    const result = review(
      [
        changed(shot('0-home', HOME), [
          { x: 790, y: 590, width: 10, height: 10 },
        ]),
      ],
      { '0-home': [LARGE_PAGE, LARGE_PAGE] },
    );

    expect(cropBoxes(result)).toStrictEqual([
      { x: 480, y: 440, width: 320, height: 160 },
    ]);
  });

  test('a page smaller than the minimum crop is cropped whole', () => {
    const result = review(
      [
        changed(shot('0-home', HOME), [
          { x: 50, y: 40, width: 10, height: 10 },
        ]),
      ],
      { '0-home': [png(200, 100), png(200, 100)] },
    );

    expect(cropBoxes(result)).toStrictEqual([
      { x: 0, y: 0, width: 200, height: 100 },
    ]);
  });

  test('crops show Before and After at the same box', () => {
    const area = { x: 400, y: 300, width: 20, height: 10 };
    const result = review([changed(shot('0-home', HOME), [area])], {
      '0-home': [png(800, 600, [[area, BLACK]]), png(800, 600, [[area, BLUE]])],
    });
    const { before, after } = onlyCrop(result);

    expect([
      pixel(before, 150, 75),
      pixel(after, 150, 75),
      pixel(before, 149, 75),
      pixel(after, 149, 75),
    ]).toStrictEqual([
      [0, 0, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 255, 255],
      [255, 255, 255, 255],
    ]);
  });

  test('images of different sizes are cropped within the larger one', () => {
    const area = { x: 100, y: 310, width: 20, height: 20 };
    const result = review([changed(shot('0-home', HOME), [area])], {
      '0-home': [PAGE, png(400, 340, [[area, BLACK]])],
    });

    expect(cropBoxes(result)).toStrictEqual([
      { x: 0, y: 180, width: 320, height: 160 },
    ]);
  });

  test('a crop at the right edge of a wider After is moved inside the After', () => {
    const area = { x: 420, y: 100, width: 10, height: 10 };
    const result = review([changed(shot('0-home', HOME), [area])], {
      '0-home': [PAGE, png(440, 300, [[area, BLACK]])],
    });

    expect(cropBoxes(result)).toStrictEqual([
      { x: 120, y: 25, width: 320, height: 160 },
    ]);
  });

  test('the part of a crop beyond the smaller image is transparent', () => {
    const area = { x: 100, y: 310, width: 20, height: 20 };
    const result = review([changed(shot('0-home', HOME), [area])], {
      '0-home': [PAGE, png(400, 340, [[area, BLACK]])],
    });
    const { before, after } = onlyCrop(result);

    expect([
      size(before),
      pixel(before, 0, 119),
      pixel(before, 0, 120),
      pixel(after, 0, 120),
    ]).toStrictEqual([
      [320, 160],
      [255, 255, 255, 255],
      [0, 0, 0, 0],
      [255, 255, 255, 255],
    ]);
  });
});

test('changed screens follow their first change and changes their first variant', () => {
  const result = review(
    [
      unchanged(shot('0-home', HOME, MOBILE)),
      changed(shot('1-about', ABOUT), [BOX]),
      changed(shot('2-home', HOME), [BOX]),
      changed(shot('3-about', ABOUT, MOBILE), [BOX]),
      changed(shot('4-about', ABOUT, DESKTOP, 'dark'), [BOX]),
    ],
    {
      '1-about': [PAGE, PAGE_WITH_BLACK_BOX],
      '2-home': [PAGE, PAGE_WITH_BLACK_BOX],
      '3-about': [PAGE, PAGE_WITH_BLUE_BOX],
      '4-about': [PAGE, PAGE_WITH_BLACK_BOX],
    },
  );

  expect(changeOutline(result)).toStrictEqual([
    {
      screen: 'url:http://127.0.0.1:5173/about',
      changes: [['1-about', '4-about'], ['3-about']],
    },
    { screen: 'url:http://127.0.0.1:5173/', changes: [['2-home']] },
  ]);
});

test('a changed shot without its After image throws', () => {
  const summary: Summary = {
    version: 1,
    id: 'k3x9a2',
    beforeAt: '2026-11-24T09:00:00.000Z',
    afterAt: '2026-11-24T09:10:00.000Z',
    counts: { changed: 1, unchanged: 0, error: 0, skipped: 0 },
    shots: [changed(shot('0-home', HOME), [BOX])],
  };

  expect(() =>
    buildReview(summary, new Map([['0-home', { before: PAGE }]])),
  ).toThrow('Changed shot 0-home has no Before or After image');
});
