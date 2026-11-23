import { chromium } from 'playwright';
import type { Browser, Locator, Page } from 'playwright';
import { PNG } from 'pngjs';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'vite-plus/test';

import { renderReport } from '../src/report.ts';
import type { ReportImages } from '../src/report.ts';
import type { Shot, ShotResult, Summary } from '../src/types.ts';

function png(
  width: number,
  height: number,
  rgba: [number, number, number, number],
): Buffer {
  const image = new PNG({ width, height });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data.set(rgba, offset);
  }
  return PNG.sync.write(image);
}

function urlShot(key: string, url: string): Shot {
  return {
    key,
    target: { kind: 'url', url },
    viewport: { width: 1280, height: 720 },
    colorScheme: 'light',
  };
}

function storyShot(
  key: string,
  title: string,
  name: string,
  storyId: string,
): Shot {
  return {
    key,
    target: {
      kind: 'story',
      url: `http://127.0.0.1:6006/iframe.html?id=${storyId}&viewMode=story`,
      storyId,
      title,
      name,
      importPath: './src/Button.stories.tsx',
    },
    viewport: { width: 1280, height: 720 },
    colorScheme: 'dark',
  };
}

const WHITE = png(200, 100, [255, 255, 255, 255]);
const GRAY = png(200, 100, [180, 180, 180, 255]);
const TALL_GRAY = png(200, 120, [180, 180, 180, 255]);
const RED = png(200, 120, [255, 0, 0, 255]);

const MIXED: Summary = {
  version: 1,
  id: 'run-mixed',
  beforeAt: '2026-11-23T08:00:00.000Z',
  afterAt: '2026-11-23T08:05:00.000Z',
  counts: { changed: 2, error: 1, unchanged: 2, skipped: 1 },
  shots: [
    {
      shot: urlShot('0-about', 'http://127.0.0.1:5173/about'),
      status: 'unchanged',
      warnings: [],
      files: { before: 'before/0-about.png', after: 'after/0-about.png' },
    },
    {
      shot: urlShot('1-home', 'http://127.0.0.1:5173/home'),
      status: 'changed',
      diff: {
        mismatchedPixels: 500,
        mismatchRatio: 0.025,
        bbox: { x: 50, y: 25, width: 100, height: 50 },
      },
      warnings: [],
      files: {
        before: 'before/1-home.png',
        after: 'after/1-home.png',
        diff: 'diff/1-home.png',
      },
    },
    {
      shot: storyShot('2-disabled', 'Button', 'Disabled', 'button--disabled'),
      status: 'skipped',
      skipReason: 'The story is tagged !ui-compare',
      warnings: [],
      files: {},
    },
    {
      shot: urlShot('3-admin', 'http://127.0.0.1:5173/admin'),
      status: 'error',
      error: {
        phase: 'after',
        message: 'net::ERR_CONNECTION_REFUSED at http://127.0.0.1:5173/admin',
      },
      warnings: [],
      files: { before: 'before/3-admin.png' },
    },
    {
      shot: storyShot('4-primary', 'Button', 'Primary', 'button--primary'),
      status: 'changed',
      diff: {
        mismatchedPixels: 400,
        mismatchRatio: 0.0167,
        bbox: { x: 0, y: 80, width: 200, height: 40 },
        dimensions: { before: [200, 100], after: [200, 120] },
      },
      unstable: {
        mismatchRatio: 0.0042,
        bbox: { x: 0, y: 0, width: 40, height: 10 },
      },
      warnings: ['Web fonts were still loading after 5000 ms'],
      files: {
        before: 'before/4-primary.png',
        after: 'after/4-primary.png',
        diff: 'diff/4-primary.png',
        unstable: 'unstable/4-primary.png',
      },
    },
    {
      shot: urlShot('5-contact', 'http://127.0.0.1:5173/contact'),
      status: 'unchanged',
      warnings: [],
      files: { before: 'before/5-contact.png', after: 'after/5-contact.png' },
    },
  ],
};

const MIXED_IMAGES: ReportImages = new Map([
  ['0-about', { before: WHITE, after: WHITE }],
  ['1-home', { before: WHITE, after: GRAY, diff: RED }],
  ['3-admin', { before: WHITE }],
  ['4-primary', { before: WHITE, after: TALL_GRAY, diff: RED, unstable: GRAY }],
  ['5-contact', { before: GRAY, after: GRAY }],
]);

const CLEAN: Summary = {
  version: 1,
  id: 'run-clean',
  beforeAt: '2026-11-23T08:00:00.000Z',
  afterAt: '2026-11-23T08:05:00.000Z',
  counts: { changed: 0, error: 0, unchanged: 1, skipped: 0 },
  shots: [
    {
      shot: urlShot('0-about', 'http://127.0.0.1:5173/about'),
      status: 'unchanged',
      warnings: [],
      files: { before: 'before/0-about.png', after: 'after/0-about.png' },
    },
  ],
};

const EMPTY: Summary = {
  version: 1,
  id: 'run-empty',
  beforeAt: '2026-11-23T08:00:00.000Z',
  afterAt: '2026-11-23T08:05:00.000Z',
  counts: { changed: 0, error: 0, unchanged: 0, skipped: 0 },
  shots: [],
};

function changed(shot: Shot, warnings: string[] = []): ShotResult {
  return {
    shot,
    status: 'changed',
    diff: {
      mismatchedPixels: 100,
      mismatchRatio: 0.01,
      bbox: { x: 0, y: 0, width: 10, height: 10 },
    },
    warnings,
    files: {},
  };
}

function changedRun(id: string, shots: ShotResult[]): Summary {
  return {
    version: 1,
    id,
    beforeAt: '2026-11-23T08:00:00.000Z',
    afterAt: '2026-11-23T08:05:00.000Z',
    counts: { changed: shots.length, error: 0, unchanged: 0, skipped: 0 },
    shots,
  };
}

const TALL = changedRun('run-tall', [
  changed(urlShot('0-tall', 'http://127.0.0.1:5173/tall')),
  changed(urlShot('1-short', 'http://127.0.0.1:5173/short')),
]);

const TALL_IMAGES: ReportImages = new Map([
  [
    '0-tall',
    {
      before: png(200, 4000, [255, 255, 255, 255]),
      after: png(200, 4000, [180, 180, 180, 255]),
    },
  ],
  ['1-short', { before: WHITE, after: GRAY }],
]);

const RESIZED = changedRun('run-resized', [
  changed(urlShot('0-wider', 'http://127.0.0.1:5173/wider')),
]);

const RESIZED_IMAGES: ReportImages = new Map([
  [
    '0-wider',
    {
      before: png(1280, 800, [255, 255, 255, 255]),
      after: png(1400, 800, [180, 180, 180, 255]),
    },
  ],
]);

const HOSTILE: Summary = {
  version: 1,
  id: 'run-</title><script>window.pwned = true</script>',
  beforeAt: '2026-11-23T08:00:00.000Z',
  afterAt: '2026-11-23T08:05:00.000Z',
  counts: { changed: 0, error: 1, unchanged: 0, skipped: 0 },
  shots: [
    {
      shot: urlShot('0-search', 'http://127.0.0.1:5173/search'),
      status: 'error',
      error: {
        phase: 'before',
        message:
          '<img src=x onerror="window.pwned = true"></script><!--<script>',
      },
      warnings: [],
      files: {},
    },
  ],
};

function embeddedSummary(html: string): unknown {
  const match =
    /<script type="application\/json" id="summary">([^<]*)<\/script>/.exec(
      html,
    );
  if (!match?.[1]) throw new Error('the report embeds no summary payload');
  return JSON.parse(match[1]);
}

describe('renderReport payload', () => {
  test('embeds the summary as JSON that parses back unchanged', () => {
    const html = renderReport(HOSTILE, new Map());

    expect(embeddedSummary(html)).toStrictEqual(HOSTILE);
  });
});

describe('renderReport in Chromium', () => {
  let browser: Browser;
  const pages: Page[] = [];

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterEach(async () => {
    await Promise.all(pages.splice(0).map((page) => page.close()));
  });

  afterAll(async () => {
    await browser.close();
  });

  async function newPage(): Promise<Page> {
    const page = await browser.newPage();
    pages.push(page);
    return page;
  }

  async function open(
    summary: Summary,
    images: ReportImages = new Map(),
  ): Promise<Page> {
    const page = await newPage();
    await page.setContent(renderReport(summary, images));
    return page;
  }

  async function listedNames(page: Page): Promise<string[]> {
    const rows = await page.getByRole('option').allInnerTexts();
    return rows.map((row) => row.split('\n')[0] ?? '');
  }

  async function selectedName(page: Page): Promise<string> {
    const [row = ''] = await page
      .getByRole('option', { selected: true })
      .allInnerTexts();
    return row.split('\n')[0] ?? '';
  }

  async function box(
    locator: Locator,
  ): Promise<{ x: number; y: number; width: number; height: number }> {
    const rect = await locator.boundingBox();
    if (!rect) throw new Error('the element is not rendered');
    return rect;
  }

  function collectConsoleErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    return errors;
  }

  function collectNetworkRequests(page: Page): string[] {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('data:')) requests.push(request.url());
    });
    return requests;
  }

  // Where the pixel at (x, y) of a screenshot of the given natural size is
  // drawn on screen.
  async function screenPoint(
    page: Page,
    name: string,
    natural: { width: number; height: number },
    point: { x: number; y: number },
  ): Promise<{ x: number; y: number }> {
    const rect = await box(page.getByRole('img', { name, exact: true }));
    return {
      x: rect.x + (point.x * rect.width) / natural.width,
      y: rect.y + (point.y * rect.height) / natural.height,
    };
  }

  async function horizontalOverflow(locator: Locator): Promise<number> {
    return locator.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    );
  }

  async function decodedWidth(page: Page, name: string): Promise<number> {
    return page
      .getByRole('img', { name, exact: true })
      .evaluate(async (image: HTMLImageElement) => {
        await image.decode();
        return image.naturalWidth;
      });
  }

  test('lists changed shots and then errors, each in summary order, by default', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    expect(await listedNames(page)).toStrictEqual([
      '127.0.0.1:5173/home',
      'Button / Primary',
      '127.0.0.1:5173/admin',
    ]);
  });

  test('showing every status lists unchanged and then skipped shots after the errors', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    await page.getByRole('button', { name: '2 unchanged' }).click();
    await page.getByRole('button', { name: '1 skipped' }).click();

    expect(await listedNames(page)).toStrictEqual([
      '127.0.0.1:5173/home',
      'Button / Primary',
      '127.0.0.1:5173/admin',
      '127.0.0.1:5173/about',
      '127.0.0.1:5173/contact',
      'Button / Disabled',
    ]);
  });

  test('the header shows the run id, both timestamps and the counts per status', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    const overview = page.getByRole('complementary', { name: 'Run overview' });
    expect(await overview.getByRole('term').allInnerTexts()).toStrictEqual([
      'Run',
      'Before',
      'After',
    ]);
    expect(await overview.getByRole('definition').first().textContent()).toBe(
      'run-mixed',
    );
    expect(
      await overview
        .locator('time')
        .evaluateAll((times) =>
          times.map((time) => time.getAttribute('datetime')),
        ),
    ).toStrictEqual(['2026-11-23T08:00:00.000Z', '2026-11-23T08:05:00.000Z']);
    expect(
      await overview
        .getByRole('group', { name: 'Filter by status' })
        .getByRole('button')
        .allTextContents(),
    ).toStrictEqual(['2 changed', '1 error', '2 unchanged', '1 skipped']);
  });

  test('selecting a changed shot shows its Before and After as embedded images', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    await page.getByRole('option', { name: /Button \/ Primary/ }).click();

    const before = page.getByRole('img', { name: 'Before screenshot' });
    const after = page.getByRole('img', { name: 'After screenshot' });
    expect(await page.getByRole('heading', { level: 2 }).textContent()).toBe(
      'Button / Primary',
    );
    expect(await before.getAttribute('src')).toMatch(
      /^data:image\/png;base64,/,
    );
    expect(await after.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(await decodedWidth(page, 'Before screenshot')).toBe(200);
    expect(await decodedWidth(page, 'After screenshot')).toBe(200);
  });

  test('a changed shot lists its viewport, color scheme, mismatch, changed area and size change', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    await page.getByRole('option', { name: /Button \/ Primary/ }).click();

    const facts = page.getByRole('main').locator('dl');
    expect(await facts.getByRole('term').allInnerTexts()).toStrictEqual([
      'Viewport',
      'Color scheme',
      'Mismatch',
      'Changed area',
      'Size',
    ]);
    expect(await facts.getByRole('definition').allInnerTexts()).toStrictEqual([
      '1280×720',
      'dark',
      '1.67% · 400 px',
      'x 0, y 80, 200×40',
      '200×100 → 200×120',
    ]);
  });

  test('the slider mode stacks After over Before under a divider control', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    await page.getByRole('button', { name: 'slider' }).click();

    expect(
      await page.getByRole('slider', { name: 'Divider position' }).inputValue(),
    ).toBe('50');
    expect(
      await page.getByRole('img', { name: 'Before screenshot' }).isVisible(),
    ).toBe(true);
    expect(
      await page.getByRole('img', { name: 'After screenshot' }).isVisible(),
    ).toBe(true);
  });

  test('the blink mode alternates between Before and After', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    await page.getByRole('button', { name: 'blink' }).click();

    await expect(
      page.getByRole('img', { name: 'After screenshot' }).waitFor(),
    ).resolves.toBeUndefined();
    await expect(
      page.getByRole('img', { name: 'Before screenshot' }).waitFor(),
    ).resolves.toBeUndefined();
  });

  test('the diff mode shows the diff image', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    await page.getByRole('button', { name: 'diff' }).click();

    expect(await decodedWidth(page, 'Diff')).toBe(200);
    expect(await page.getByRole('img', { name: /screenshot/ }).count()).toBe(0);
  });

  test('number keys switch the comparison mode', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    await page.keyboard.press('4');

    expect(
      await page
        .getByRole('button', { name: 'diff' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(await page.getByRole('img', { name: 'Diff' }).isVisible()).toBe(
      true,
    );
  });

  test('number keys switch the comparison mode while the slider has focus', async () => {
    const page = await open(MIXED, MIXED_IMAGES);
    await page.getByRole('button', { name: 'slider' }).click();
    await page.getByRole('slider', { name: 'Divider position' }).focus();

    await page.keyboard.press('4');

    expect(await page.getByRole('img', { name: 'Diff' }).isVisible()).toBe(
      true,
    );
  });

  test('the search field narrows the list to matching shots', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    await page.getByRole('combobox', { name: 'Filter shots' }).fill('button');

    expect(await listedNames(page)).toStrictEqual(['Button / Primary']);
  });

  test('ArrowDown selects and shows the next shot', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    await page.keyboard.press('ArrowDown');

    expect(await selectedName(page)).toBe('Button / Primary');
    expect(await page.getByRole('heading', { level: 2 }).textContent()).toBe(
      'Button / Primary',
    );
  });

  test('ArrowUp selects the previous shot', async () => {
    const page = await open(MIXED, MIXED_IMAGES);
    await page.getByRole('option', { name: /admin/ }).click();

    await page.keyboard.press('ArrowUp');

    expect(await selectedName(page)).toBe('Button / Primary');
  });

  test('arrow keys keep focus on the selected option while moving through the list', async () => {
    const page = await open(MIXED, MIXED_IMAGES);
    await page.getByRole('option', { selected: true }).focus();

    await page.keyboard.press('ArrowDown');

    expect(
      await page
        .getByRole('option', { selected: true })
        .evaluate((option) => option === document.activeElement),
    ).toBe(true);
  });

  test('the changed area outline over After scales with the displayed image', async () => {
    const summary: Summary = {
      version: 1,
      id: 'run-wide',
      beforeAt: '2026-11-23T08:00:00.000Z',
      afterAt: '2026-11-23T08:05:00.000Z',
      counts: { changed: 1, error: 0, unchanged: 0, skipped: 0 },
      shots: [
        {
          shot: urlShot('0-wide', 'http://127.0.0.1:5173/wide'),
          status: 'changed',
          diff: {
            mismatchedPixels: 500_000,
            mismatchRatio: 0.25,
            bbox: { x: 500, y: 250, width: 1000, height: 500 },
          },
          warnings: [],
          files: {},
        },
      ],
    };
    const wide = png(2000, 1000, [255, 255, 255, 255]);
    const page = await open(
      summary,
      new Map([['0-wide', { before: wide, after: wide }]]),
    );

    const image = await box(
      page.getByRole('img', { name: 'After screenshot' }),
    );
    const outline = await box(
      page.getByRole('figure', { name: 'After' }).locator('.bbox'),
    );

    expect(image.width).toBeLessThan(1000);
    expect((outline.x - image.x) / image.width).toBeCloseTo(0.25, 2);
    expect((outline.y - image.y) / image.height).toBeCloseTo(0.25, 2);
    expect(outline.width / image.width).toBeCloseTo(0.5, 2);
    expect(outline.height / image.height).toBeCloseTo(0.5, 2);
  });

  test('an unstable shot carries a badge and a note that differences in its box may be noise', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    await page.getByRole('option', { name: /Button \/ Primary/ }).click();

    const main = page.getByRole('main');
    expect(
      await main.locator('span', { hasText: /^unstable$/ }).isVisible(),
    ).toBe(true);
    expect(
      await main.getByRole('heading', { name: 'Unstable' }).isVisible(),
    ).toBe(true);
    expect(await main.getByText(/already differed/).textContent()).toBe(
      'This page already differed between two loads before the change (0.42% of pixels, x 0, y 0, 40×10). Differences inside that box may be noise.',
    );
  });

  test('an unstable shot offers its unstable image as an extra view', async () => {
    const page = await open(MIXED, MIXED_IMAGES);
    await page.getByRole('option', { name: /Button \/ Primary/ }).click();

    await page.getByRole('button', { name: 'unstable' }).click();

    expect(await decodedWidth(page, 'Unstable diff')).toBe(200);
  });

  test('an error shot shows the failing phase and the message', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    await page.getByRole('option', { name: /admin/ }).click();

    const main = page.getByRole('main');
    expect(
      await main
        .getByRole('heading', { name: 'Capture failed during After' })
        .isVisible(),
    ).toBe(true);
    expect(
      await main
        .getByText('net::ERR_CONNECTION_REFUSED at http://127.0.0.1:5173/admin')
        .isVisible(),
    ).toBe(true);
  });

  test('a skipped shot shows why it was skipped', async () => {
    const page = await open(MIXED, MIXED_IMAGES);
    await page.getByRole('button', { name: '1 skipped' }).click();

    await page.getByRole('option', { name: /Disabled/ }).click();

    expect(
      await page
        .getByRole('main')
        .getByText('The story is tagged !ui-compare')
        .isVisible(),
    ).toBe(true);
  });

  test('a shot lists its capture warnings', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    await page.getByRole('option', { name: /Button \/ Primary/ }).click();

    expect(
      await page.getByRole('main').getByRole('listitem').allInnerTexts(),
    ).toStrictEqual(['Web fonts were still loading after 5000 ms']);
  });

  test('a run without changes or errors offers to show every status', async () => {
    const page = await open(
      CLEAN,
      new Map([['0-about', { before: WHITE, after: WHITE }]]),
    );

    expect(await page.getByRole('option').count()).toBe(0);
    await page.getByRole('button', { name: 'Show all statuses' }).click();

    expect(await listedNames(page)).toStrictEqual(['127.0.0.1:5173/about']);
  });

  test('a run without shots shows an empty state instead of a list', async () => {
    const page = await open(EMPTY);

    expect(
      await page
        .getByRole('heading', { name: 'No shots in this run' })
        .isVisible(),
    ).toBe(true);
    expect(await page.getByRole('listbox').isVisible()).toBe(false);
  });

  test('summary strings containing markup are shown as text', async () => {
    const page = await open(HOSTILE);

    expect(await page.title()).toBe(
      'ui-compare · run-</title><script>window.pwned = true</script>',
    );
    expect(
      await page
        .getByText(
          '<img src=x onerror="window.pwned = true"></script><!--<script>',
        )
        .isVisible(),
    ).toBe(true);
    expect(await page.getByRole('img').count()).toBe(0);
    expect(await page.evaluate(() => 'pwned' in window)).toBe(false);
  });

  test('switching through every shot and mode logs no console errors', async () => {
    const page = await newPage();
    const errors = collectConsoleErrors(page);
    await page.setContent(renderReport(MIXED, MIXED_IMAGES));

    await page.getByRole('button', { name: '2 unchanged' }).click();
    await page.getByRole('button', { name: '1 skipped' }).click();
    for (let shot = 0; shot < 6; shot++) {
      for (const key of ['1', '2', '3', '4', '5']) {
        await page.keyboard.press(key);
      }
      await page.keyboard.press('ArrowDown');
    }

    expect(errors).toStrictEqual([]);
  });

  test('the report makes no network request', async () => {
    const page = await newPage();
    const requests = collectNetworkRequests(page);

    await page.setContent(renderReport(MIXED, MIXED_IMAGES));
    await page.getByRole('button', { name: 'slider' }).click();

    expect(requests).toStrictEqual([]);
  });

  test('the verdict reads the review count and its noun as separate words', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    expect(await page.getByRole('heading', { level: 1 }).ariaSnapshot()).toBe(
      '- heading "3 shots to review" [level=1]',
    );
  });

  test('a long shot name does not widen the page at 320px', async () => {
    const page = await open(
      changedRun('run-long-name', [
        changed(
          storyShot(
            '0-range',
            'Components/Forms/DatePicker',
            'With Range Selection',
            'components-forms-datepicker--with-range-selection',
          ),
        ),
      ]),
      new Map([['0-range', { before: WHITE, after: GRAY }]]),
    );

    await page.setViewportSize({ width: 320, height: 640 });

    expect(await horizontalOverflow(page.locator('html'))).toBe(0);
  });

  test('a long unbroken warning wraps inside the stage at 375px', async () => {
    const page = await open(
      changedRun('run-long-warning', [
        changed(urlShot('0-home', 'http://127.0.0.1:5173/home'), [
          `Failed to load http://127.0.0.1:5173/node_modules/.vite/deps/chunk.js?v=${'0123456789abcdef'.repeat(8)}`,
        ]),
      ]),
      new Map([['0-home', { before: WHITE, after: GRAY }]]),
    );

    await page.setViewportSize({ width: 375, height: 667 });

    expect(
      await horizontalOverflow(
        page.getByRole('region', { name: 'Comparison' }),
      ),
    ).toBe(0);
  });

  test('the slider draws Before and After from one top-left corner at one scale', async () => {
    const page = await open(RESIZED, RESIZED_IMAGES);

    await page.getByRole('button', { name: 'slider' }).click();

    const point = { x: 1000, y: 600 };
    const before = await screenPoint(
      page,
      'Before screenshot',
      { width: 1280, height: 800 },
      point,
    );
    const after = await screenPoint(
      page,
      'After screenshot',
      { width: 1400, height: 800 },
      point,
    );
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  test('blink draws Before and After from one top-left corner at one scale', async () => {
    const page = await newPage();
    await page.clock.install();
    await page.setContent(renderReport(RESIZED, RESIZED_IMAGES));
    await page.getByRole('button', { name: 'blink' }).click();

    const point = { x: 1000, y: 600 };
    const before = await screenPoint(
      page,
      'Before screenshot',
      { width: 1280, height: 800 },
      point,
    );
    await page.clock.runFor(700);
    const after = await screenPoint(
      page,
      'After screenshot',
      { width: 1400, height: 800 },
      point,
    );

    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  test('switching the mode keeps a tall shot scrolled to the same place', async () => {
    const page = await open(TALL, TALL_IMAGES);
    const stage = page.getByRole('region', { name: 'Comparison' });
    await stage.evaluate((element) => {
      element.scrollTop = element.scrollHeight / 2;
    });

    await page.keyboard.press('2');

    expect(
      await stage.evaluate(
        (element) => element.scrollTop / element.scrollHeight,
      ),
    ).toBeCloseTo(0.5, 2);
  });

  test('toggling a status that keeps the selected shot leaves the slider where it was', async () => {
    const page = await open(MIXED, MIXED_IMAGES);
    await page.getByRole('button', { name: 'slider' }).click();
    const slider = page.getByRole('slider', { name: 'Divider position' });
    await slider.fill('80');

    await page.getByRole('button', { name: '2 unchanged' }).click();

    expect(await slider.inputValue()).toBe('80');
  });

  test('showing more statuses enables Next shot on what was the last shot', async () => {
    const page = await open(MIXED, MIXED_IMAGES);
    await page.getByRole('option', { name: /admin/ }).click();
    const next = page.getByRole('button', { name: 'Next shot' });
    expect(await next.getAttribute('aria-disabled')).toBe('true');

    await page.getByRole('button', { name: '2 unchanged' }).click();

    expect(await next.getAttribute('aria-disabled')).toBeNull();
  });

  test('ArrowUp on the first shot leaves focus on the same option', async () => {
    const page = await open(MIXED, MIXED_IMAGES);
    const option = page.getByRole('option', { selected: true });
    await option.focus();
    const focused = await option.elementHandle();

    await page.keyboard.press('ArrowUp');

    expect(
      await focused.evaluate((element) => element === document.activeElement),
    ).toBe(true);
  });

  test('ArrowDown confirming an IME candidate in the search field keeps the selection', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    await page
      .getByRole('combobox', { name: 'Filter shots' })
      .dispatchEvent('keydown', { key: 'ArrowDown', isComposing: true });

    expect(await selectedName(page)).toBe('127.0.0.1:5173/home');
  });

  test('ArrowDown with keyCode 229 in the search field keeps the selection', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    await page
      .getByRole('combobox', { name: 'Filter shots' })
      .dispatchEvent('keydown', { key: 'ArrowDown', keyCode: 229 });

    expect(await selectedName(page)).toBe('127.0.0.1:5173/home');
  });

  test('Escape cancelling an IME composition keeps the search query', async () => {
    const page = await open(MIXED, MIXED_IMAGES);
    const search = page.getByRole('combobox', { name: 'Filter shots' });
    await search.fill('home');

    await search.dispatchEvent('keydown', { key: 'Escape', isComposing: true });

    expect(await search.inputValue()).toBe('home');
  });

  test('a composing keydown outside the search field keeps the selection', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    await page
      .locator('body')
      .dispatchEvent('keydown', { key: 'ArrowDown', isComposing: true });

    expect(await selectedName(page)).toBe('127.0.0.1:5173/home');
  });

  test('Tab moves from the pager into the scrollable stage', async () => {
    const page = await open(MIXED, MIXED_IMAGES);
    await page.getByRole('button', { name: 'Next shot' }).focus();

    await page.keyboard.press('Tab');

    expect(
      await page
        .getByRole('region', { name: 'Comparison' })
        .evaluate((stage) => stage === document.activeElement),
    ).toBe(true);
  });

  test('ArrowDown on the focused stage scrolls it instead of moving to the next shot', async () => {
    const page = await open(TALL, TALL_IMAGES);
    const stage = page.getByRole('region', { name: 'Comparison' });
    await stage.focus();

    await page.keyboard.press('ArrowDown');

    expect(await selectedName(page)).toBe('127.0.0.1:5173/tall');
    await expect
      .poll(() => stage.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
  });
});
