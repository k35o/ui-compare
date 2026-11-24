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
import type {
  Crop,
  Review,
  Screen,
  ShotImages,
  Variant,
} from '../src/review.ts';

type Rgba = [number, number, number, number];

const WHITE: Rgba = [255, 255, 255, 255];
const GRAY: Rgba = [180, 180, 180, 255];
const RED: Rgba = [255, 0, 0, 255];
const TRANSPARENT: Rgba = [0, 0, 0, 0];

function png(width: number, height: number, rgba: Rgba): Buffer {
  const image = new PNG({ width, height });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data.set(rgba, offset);
  }
  return PNG.sync.write(image);
}

const HOME = 'http://127.0.0.1:5173/home';
const ADMIN = 'http://127.0.0.1:5173/admin';
const NEWS = 'http://127.0.0.1:5173/news';
const ABOUT = 'http://127.0.0.1:5173/about';

function urlScreen(url: string): Screen {
  return { key: url, kind: 'url', label: url };
}

function componentScreen(title: string): Screen {
  return { key: title, kind: 'component', label: title };
}

function variant(shotKey: string, extra: Partial<Variant> = {}): Variant {
  return {
    shotKey,
    viewport: { width: 1280, height: 720 },
    colorScheme: 'light',
    warnings: [],
    ...extra,
  };
}

const CROP: Crop = {
  area: { x: 58, y: 40, width: 24, height: 1 },
  box: { x: 10, y: 20, width: 120, height: 40 },
  before: png(120, 40, WHITE),
  after: png(120, 40, GRAY),
};

const PAGE_BEFORE = png(320, 200, WHITE);
const PAGE_AFTER = png(320, 200, GRAY);
const PAGE_DIFF = png(320, 200, RED);

const MIXED: Review = {
  id: 'run-mixed',
  beforeAt: '2026-11-23T08:00:00.000Z',
  afterAt: '2026-11-23T08:05:00.000Z',
  errors: [
    {
      screen: urlScreen(ADMIN),
      variants: [variant('0-admin')],
      phase: 'after',
      message: 'net::ERR_CONNECTION_REFUSED at http://127.0.0.1:5173/admin',
    },
  ],
  changed: [
    {
      screen: urlScreen(HOME),
      changes: [
        {
          variants: [
            variant('1-home'),
            variant('2-home', { viewport: { width: 375, height: 812 } }),
          ],
          crops: [CROP],
          fullPage: false,
        },
      ],
    },
    {
      screen: componentScreen('Button'),
      changes: [
        {
          variants: [
            variant('3-primary', { story: 'Primary', colorScheme: 'dark' }),
          ],
          crops: [],
          fullPage: true,
        },
      ],
    },
  ],
  noise: [{ screen: urlScreen(NEWS), variants: [variant('4-news')] }],
  unchanged: [{ screen: urlScreen(ABOUT), variants: [variant('5-about')] }],
  skipped: [
    {
      screen: componentScreen('Card'),
      variants: [variant('6-card', { story: 'Loading' })],
      reason: 'parameters.vrt.skip is set',
    },
  ],
};

const MIXED_IMAGES: ShotImages = new Map([
  ['1-home', { before: PAGE_BEFORE, after: PAGE_AFTER, diff: PAGE_DIFF }],
  ['2-home', { before: PAGE_BEFORE, after: PAGE_AFTER, diff: PAGE_DIFF }],
  ['3-primary', { before: PAGE_BEFORE, after: PAGE_AFTER, diff: PAGE_DIFF }],
  [
    '4-news',
    {
      before: PAGE_BEFORE,
      after: PAGE_AFTER,
      diff: PAGE_DIFF,
      unstable: PAGE_AFTER,
    },
  ],
  ['5-about', { before: PAGE_BEFORE, after: PAGE_BEFORE }],
]);

const CLEAN: Review = {
  id: 'run-clean',
  beforeAt: '2026-11-23T08:00:00.000Z',
  afterAt: '2026-11-23T08:05:00.000Z',
  errors: [],
  changed: [],
  noise: [],
  unchanged: [{ screen: urlScreen(ABOUT), variants: [variant('0-about')] }],
  skipped: [],
};

const RESIZED: Review = {
  id: 'run-resized',
  beforeAt: '2026-11-23T08:00:00.000Z',
  afterAt: '2026-11-23T08:05:00.000Z',
  errors: [],
  changed: [
    {
      screen: urlScreen(HOME),
      changes: [
        { variants: [variant('0-wider')], crops: [CROP], fullPage: false },
      ],
    },
  ],
  noise: [],
  unchanged: [],
  skipped: [],
};

const RESIZED_IMAGES: ShotImages = new Map([
  [
    '0-wider',
    {
      before: png(1280, 800, WHITE),
      after: png(1400, 800, GRAY),
      diff: png(1400, 800, RED),
    },
  ],
]);

const HOSTILE: Review = {
  id: 'run-</title><script>window.pwned = true</script>',
  beforeAt: '2026-11-23T08:00:00.000Z',
  afterAt: '2026-11-23T08:05:00.000Z',
  errors: [
    {
      screen: urlScreen('http://127.0.0.1:5173/search'),
      variants: [variant('0-search')],
      phase: 'before',
      message: '<img src=x onerror="window.pwned = true"></script><!--<script>',
    },
  ],
  changed: [],
  noise: [],
  unchanged: [],
  skipped: [],
};

function changedRun(id: string, changed: Review['changed']): Review {
  return {
    id,
    beforeAt: '2026-11-23T08:00:00.000Z',
    afterAt: '2026-11-23T08:05:00.000Z',
    errors: [],
    changed,
    noise: [],
    unchanged: [],
    skipped: [],
  };
}

function cropOf(width: number, height: number, before: Rgba): Crop {
  return {
    area: { x: 48, y: 48, width: width - 96, height: height - 96 },
    box: { x: 0, y: 0, width, height },
    before: png(width, height, before),
    after: png(width, height, GRAY),
  };
}

function embedded(html: string, id: string): unknown {
  const match = new RegExp(
    `<script type="application/json" id="${id}">([^<]*)</script>`,
  ).exec(html);
  if (!match?.[1]) throw new Error(`the report embeds no ${id} payload`);
  return JSON.parse(match[1]);
}

function contentSecurityPolicy(html: string): Record<string, string[]> {
  const match =
    /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html);
  if (!match?.[1]) throw new Error('the report declares no CSP');
  return Object.fromEntries(
    match[1].split(';').map((directive) => {
      const [name = '', ...values] = directive.trim().split(/\s+/);
      return [name, values];
    }),
  );
}

const SHA256 = expect.stringMatching(/^'sha256-[A-Za-z0-9+/]{43}='$/);

describe('renderReport payload', () => {
  test('embeds the review as JSON without a raw "<"', () => {
    const html = renderReport(HOSTILE, new Map());

    expect(embedded(html, 'review')).toMatchObject({
      id: 'run-</title><script>window.pwned = true</script>',
      errors: [
        {
          message:
            '<img src=x onerror="window.pwned = true"></script><!--<script>',
        },
      ],
    });
  });

  test('embeds only the images each entry shows, for its first variant', () => {
    const all = {
      before: PAGE_BEFORE,
      after: PAGE_AFTER,
      diff: PAGE_DIFF,
      unstable: PAGE_AFTER,
    };
    const images: ShotImages = new Map(
      [
        '0-admin',
        '1-home',
        '2-home',
        '3-primary',
        '4-news',
        '5-about',
        '6-card',
      ].map((key) => [key, all]),
    );

    const shown = embedded(renderReport(MIXED, images), 'images') as Record<
      string,
      object
    >;

    expect(
      Object.fromEntries(
        Object.entries(shown).map(([key, kinds]) => [key, Object.keys(kinds)]),
      ),
    ).toStrictEqual({
      '1-home': ['before', 'after', 'diff'],
      '3-primary': ['before', 'after', 'diff'],
      '4-news': ['before', 'after', 'unstable'],
      '5-about': ['before', 'after'],
      '6-card': ['before', 'after'],
    });
  });

  test('allows only its own inline script and style and data: images', () => {
    expect(
      contentSecurityPolicy(renderReport(MIXED, MIXED_IMAGES)),
    ).toStrictEqual({
      'default-src': ["'none'"],
      'img-src': ['data:'],
      'style-src': [SHA256],
      'script-src': [SHA256],
      'base-uri': ["'none'"],
      'form-action': ["'none'"],
    });
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

  async function newPage(locale = 'en-US'): Promise<Page> {
    const page = await browser.newPage({ locale });
    pages.push(page);
    return page;
  }

  async function open(
    review: Review,
    images: ShotImages = new Map(),
    locale = 'en-US',
  ): Promise<Page> {
    const page = await newPage(locale);
    await page.setContent(renderReport(review, images));
    return page;
  }

  function card(page: Page, label: string): Locator {
    return page.getByRole('article').filter({
      has: page.getByRole('heading', { level: 2, name: label, exact: true }),
    });
  }

  async function box(
    locator: Locator,
  ): Promise<{ x: number; y: number; width: number; height: number }> {
    const rect = await locator.boundingBox();
    if (!rect) throw new Error('the element is not rendered');
    return rect;
  }

  async function openFullPage(page: Page, label: string): Promise<Locator> {
    const target = card(page, label);
    await target.getByText('View full page', { exact: true }).click();
    await target.getByRole('group', { name: 'View' }).waitFor();
    return target;
  }

  function collectNetworkRequests(page: Page): string[] {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('data:')) requests.push(request.url());
    });
    return requests;
  }

  function collectConsoleErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    return errors;
  }

  async function openEverything(page: Page): Promise<void> {
    for (const summary of await page.locator('summary').all()) {
      await summary.click();
    }
    for (const radio of await page.getByRole('radio').all()) {
      await radio.check();
    }
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

  // How far from the left edge of the named image its pixel at x is drawn.
  async function offsetOf(
    page: Page,
    name: string,
    naturalWidth: number,
    x: number,
  ): Promise<number> {
    const rect = await box(page.getByRole('img', { name, exact: true }));
    return (x * rect.width) / naturalWidth;
  }

  async function imageAt(
    page: Page,
    point: { x: number; y: number },
  ): Promise<string | null> {
    return page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.getAttribute('alt') ?? null,
      point,
    );
  }

  test('shows capture errors, then the changed screens, then the other screens', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    expect(
      await page.getByRole('heading', { level: 2 }).allInnerTexts(),
    ).toStrictEqual([
      'Could not capture',
      'http://127.0.0.1:5173/home',
      'Button',
      'Other results',
    ]);
  });

  test('lists noise, then unchanged, then skipped screens on one line each', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    expect(
      await page
        .getByRole('region', { name: 'Other results' })
        .getByRole('listitem')
        .allInnerTexts(),
    ).toStrictEqual([
      'Likely noise http://127.0.0.1:5173/news 1280×720\nChanged only where the page already differed between two loads in Before.',
      'Unchanged http://127.0.0.1:5173/about 1280×720',
      'Skipped Card Loading · 1280×720\nparameters.vrt.skip is set',
    ]);
  });

  test('the headline counts changed screens in English', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    expect(await page.getByRole('heading', { level: 1 }).textContent()).toBe(
      '2 screens changed',
    );
  });

  test('the sentence under the headline counts the other screens in English', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    expect(
      await page
        .getByText(
          '1 screen could not be captured, 1 screen changed only where Before was unstable, 1 screen unchanged, and 1 screen skipped.',
          { exact: true },
        )
        .isVisible(),
    ).toBe(true);
  });

  test('the headline counts screens that could not be captured when nothing changed', async () => {
    const page = await open({
      ...CLEAN,
      errors: [
        {
          screen: urlScreen(ADMIN),
          variants: [variant('0-admin')],
          phase: 'before',
          message: 'HTTP 500',
        },
        {
          screen: urlScreen(ADMIN),
          variants: [
            variant('1-admin', { viewport: { width: 375, height: 812 } }),
          ],
          phase: 'after',
          message: 'net::ERR_CONNECTION_REFUSED',
        },
      ],
      unchanged: [],
    });

    expect(await page.getByRole('heading', { level: 1 }).textContent()).toBe(
      '1 screen could not be captured',
    );
  });

  test('a run without shots says no screens were captured', async () => {
    const page = await open({ ...CLEAN, unchanged: [] });

    expect(await page.getByRole('heading', { level: 1 }).textContent()).toBe(
      'No screens were captured',
    );
  });

  test('the sentence under the headline counts a screen with several errors once', async () => {
    const page = await open({
      ...MIXED,
      errors: [
        {
          screen: urlScreen(ADMIN),
          variants: [variant('0-admin')],
          phase: 'before',
          message: 'HTTP 500',
        },
        {
          screen: urlScreen(ADMIN),
          variants: [
            variant('7-admin', { viewport: { width: 375, height: 812 } }),
          ],
          phase: 'after',
          message: 'net::ERR_CONNECTION_REFUSED',
        },
      ],
      noise: [],
      unchanged: [],
      skipped: [],
    });

    expect(await page.locator('.lead').textContent()).toBe(
      '1 screen could not be captured.',
    );
  });

  test('the sentence under the headline does not count a changed screen again', async () => {
    const page = await open({
      ...changedRun('run-partly', MIXED.changed.slice(0, 1)),
      unchanged: [
        {
          screen: urlScreen(HOME),
          variants: [
            variant('7-home', { viewport: { width: 1920, height: 1080 } }),
          ],
        },
        { screen: urlScreen(ABOUT), variants: [variant('5-about')] },
      ],
    });

    expect(await page.locator('.lead').textContent()).toBe(
      '1 screen unchanged.',
    );
  });

  test('the headline counts changed screens in Japanese', async () => {
    const page = await open(MIXED, MIXED_IMAGES, 'ja-JP');

    expect(await page.getByRole('heading', { level: 1 }).textContent()).toBe(
      '2 画面が変わりました',
    );
  });

  test('the Japanese headline reads naturally for twelve screens', async () => {
    const page = await open(
      changedRun(
        'run-twelve',
        Array.from({ length: 12 }, (_, index) => ({
          screen: urlScreen(`${HOME}/${index}`),
          changes: [
            {
              variants: [variant(`${index}-home`)],
              crops: [CROP],
              fullPage: false,
            },
          ],
        })),
      ),
      new Map(),
      'ja-JP',
    );

    expect(await page.getByRole('heading', { level: 1 }).textContent()).toBe(
      '12 画面が変わりました',
    );
  });

  test('the sentence under the headline counts the other screens in Japanese', async () => {
    const page = await open(MIXED, MIXED_IMAGES, 'ja-JP');

    expect(
      await page
        .getByText(
          '撮影できなかった画面 1、変更前の時点で不安定だった箇所だけが変わった画面 1、変わらなかった画面 1、スキップした画面 1',
          { exact: true },
        )
        .isVisible(),
    ).toBe(true);
  });

  test('a Japanese report declares its language', async () => {
    const page = await open(MIXED, MIXED_IMAGES, 'ja-JP');

    expect(await page.locator('html').getAttribute('lang')).toBe('ja');
  });

  test('a capture error shows the screen, its conditions, the phase and the message', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    expect(
      await page
        .getByRole('region', { name: 'Could not capture' })
        .getByRole('article')
        .ariaSnapshot(),
    ).toBe(
      [
        '- article:',
        '  - heading "http://127.0.0.1:5173/admin" [level=3]',
        '  - paragraph: 1280×720 · Failed while capturing After',
        '  - paragraph: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:5173/admin',
      ].join('\n'),
    );
  });

  test('a change seen at several viewports lists them once and says it is the same', async () => {
    const page = await open(MIXED, MIXED_IMAGES);
    const home = card(page, HOME);

    expect(
      await home.getByRole('heading', { level: 3 }).allInnerTexts(),
    ).toStrictEqual(['1280×720 and 375×812']);
    expect(
      await home
        .getByText('The same change appears in each of these.', { exact: true })
        .isVisible(),
    ).toBe(true);
  });

  test('a change at two stories and two settings names each story and setting once', async () => {
    const mobile = { viewport: { width: 375, height: 812 } };
    const page = await open(
      changedRun('run-stories', [
        {
          screen: componentScreen('Button'),
          changes: [
            {
              variants: [
                variant('0-primary', { story: 'Primary' }),
                variant('1-primary', { story: 'Primary', ...mobile }),
                variant('2-secondary', { story: 'Secondary' }),
                variant('3-secondary', { story: 'Secondary', ...mobile }),
              ],
              crops: [CROP],
              fullPage: false,
            },
          ],
        },
      ]),
    );

    expect(
      await card(page, 'Button')
        .getByRole('heading', { level: 3 })
        .textContent(),
    ).toBe('Primary and Secondary · 1280×720 and 375×812');
  });

  test('a warning carried by two merged variants appears once', async () => {
    const warnings = ['Vite reported an error on another page'];
    const page = await open(
      changedRun('run-warned', [
        {
          screen: urlScreen(HOME),
          changes: [
            {
              variants: [
                variant('0-home', { warnings }),
                variant('1-home', {
                  warnings,
                  viewport: { width: 375, height: 812 },
                }),
              ],
              crops: [CROP],
              fullPage: false,
            },
          ],
        },
      ]),
    );

    expect(
      await card(page, HOME).getByRole('listitem').allInnerTexts(),
    ).toStrictEqual(['Warning: Vite reported an error on another page']);
  });

  test('a change that resized the page names both page sizes', async () => {
    const page = await open(
      changedRun('run-taller', [
        {
          screen: urlScreen(HOME),
          changes: [
            {
              variants: [variant('0-home')],
              crops: [CROP],
              fullPage: false,
              dimensions: { before: [1280, 1000], after: [1280, 1600] },
            },
          ],
        },
      ]),
    );

    expect(
      await card(page, HOME)
        .getByText('Page size 1280×1000 → 1280×1600', { exact: true })
        .isVisible(),
    ).toBe(true);
  });

  test('a story change names the story and the dark scheme under a Storybook tag', async () => {
    const page = await open(MIXED, MIXED_IMAGES);
    const button = card(page, 'Button');

    expect(await button.getByRole('heading', { level: 3 }).textContent()).toBe(
      'Primary · 1280×720 dark',
    );
    expect(
      await button.getByText('Storybook', { exact: true }).isVisible(),
    ).toBe(true);
  });

  test('a crop shows Before and After as embedded images at natural size', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    const shown = await Promise.all(
      ['Before', 'After'].map(async (kind) => {
        const image = page.getByRole('img', {
          name: `${kind}: ${HOME}`,
          exact: true,
        });
        const { width, height } = await box(image);
        const source = await image.evaluate((element: HTMLImageElement) =>
          element.src.slice(0, 22),
        );
        return { source, width, height };
      }),
    );

    expect(shown).toStrictEqual([
      { source: 'data:image/png;base64,', width: 120, height: 40 },
      { source: 'data:image/png;base64,', width: 120, height: 40 },
    ]);
  });

  test('a crop outlines the changed area on Before and After', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    const outlines = await Promise.all(
      ['Before', 'After'].map(async (kind) => {
        const image = page.getByRole('img', {
          name: `${kind}: ${HOME}`,
          exact: true,
        });
        const shown = await box(image);
        const mark = await box(
          image.locator('xpath=following-sibling::span[@class="mark"]'),
        );
        return {
          x: mark.x - shown.x,
          y: mark.y - shown.y,
          width: mark.width,
          height: mark.height,
        };
      }),
    );

    expect(outlines).toStrictEqual([
      { x: 48, y: 20, width: 24, height: 2 },
      { x: 48, y: 20, width: 24, height: 2 },
    ]);
  });

  test('a crop narrower than half the pane shows After next to Before', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    const before = await box(
      page.getByRole('img', { name: `Before: ${HOME}`, exact: true }),
    );
    const after = await box(
      page.getByRole('img', { name: `After: ${HOME}`, exact: true }),
    );

    expect(after.y).toBe(before.y);
    expect(after.x).toBeGreaterThan(before.x + before.width);
  });

  test('a crop wider than half the pane is drawn at its natural width', async () => {
    const page = await open(
      changedRun('run-wide', [
        {
          screen: urlScreen(HOME),
          changes: [
            {
              variants: [variant('0-home')],
              crops: [cropOf(640, 160, WHITE)],
              fullPage: false,
            },
          ],
        },
      ]),
    );

    const shown = await Promise.all(
      ['Before', 'After'].map(
        async (kind) =>
          (
            await box(
              page.getByRole('img', { name: `${kind}: ${HOME}`, exact: true }),
            )
          ).width,
      ),
    );

    expect(shown).toStrictEqual([640, 640]);
  });

  test('a crop wider than half the pane shows After below Before', async () => {
    const page = await open(
      changedRun('run-wide', [
        {
          screen: urlScreen(HOME),
          changes: [
            {
              variants: [variant('0-home')],
              crops: [cropOf(640, 160, WHITE)],
              fullPage: false,
            },
          ],
        },
      ]),
    );

    const before = await box(
      page.getByRole('img', { name: `Before: ${HOME}`, exact: true }),
    );
    const after = await box(
      page.getByRole('img', { name: `After: ${HOME}`, exact: true }),
    );

    expect(after.y).toBeGreaterThan(before.y + before.height);
  });

  test('each area of a change with two crops is numbered', async () => {
    const page = await open(
      changedRun('run-two-areas', [
        {
          screen: urlScreen(HOME),
          changes: [
            {
              variants: [variant('0-home')],
              crops: [CROP, { ...CROP, box: { ...CROP.box, y: 400 } }],
              fullPage: false,
            },
          ],
        },
      ]),
    );

    expect(
      await card(page, HOME)
        .getByText(/^Area \d of \d$/)
        .allInnerTexts(),
    ).toStrictEqual(['Area 1 of 2', 'Area 2 of 2']);
  });

  test('a transparent part of a crop shows a checkerboard', async () => {
    const page = await open(
      changedRun('run-no-page', [
        {
          screen: urlScreen(HOME),
          changes: [
            {
              variants: [variant('0-home')],
              crops: [cropOf(160, 64, TRANSPARENT)],
              fullPage: false,
            },
          ],
        },
      ]),
    );
    const before = await box(
      page.getByRole('img', { name: `Before: ${HOME}`, exact: true }),
    );

    const shot = PNG.sync.read(
      await page.screenshot({
        clip: { x: before.x, y: before.y, width: 16, height: 8 },
      }),
    );
    const colorAt = (x: number, y: number): string =>
      shot.data
        .subarray((y * shot.width + x) * 4, (y * shot.width + x) * 4 + 4)
        .join(',');

    expect(new Set([colorAt(2, 2), colorAt(10, 2)]).size).toBe(2);
  });

  test('a full-page change shows the full Before and After pages', async () => {
    const page = await open(MIXED, MIXED_IMAGES);
    const button = card(page, 'Button');

    expect(
      await button
        .getByRole('img', { name: /^(Before|After): Button, full page$/ })
        .count(),
    ).toBe(2);
  });

  test('View full page builds no images until it is opened', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    expect(await card(page, HOME).locator('details img').count()).toBe(0);
  });

  test('opening View full page offers side by side, slider and diff, side by side first', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    const home = await openFullPage(page, HOME);

    expect(await home.getByRole('group', { name: 'View' }).ariaSnapshot()).toBe(
      [
        '- group "View":',
        '  - text: View',
        '  - radio "Side by side" [checked]',
        '  - text: Side by side',
        '  - radio "Slider"',
        '  - text: Slider',
        '  - radio "Diff"',
        '  - text: Diff',
      ].join('\n'),
    );
  });

  test('side by side shows the full pages of the first variant', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    const home = await openFullPage(page, HOME);

    expect(
      await home
        .getByRole('img', { name: `Before: ${HOME}, full page`, exact: true })
        .isVisible(),
    ).toBe(true);
  });

  test('choosing Diff shows the diff image', async () => {
    const page = await open(MIXED, MIXED_IMAGES);
    const home = await openFullPage(page, HOME);

    await home.getByRole('radio', { name: 'Diff' }).check();

    expect(
      await home
        .getByRole('img', { name: `Diff: ${HOME}`, exact: true })
        .isVisible(),
    ).toBe(true);
  });

  test('the slider draws Before and After from one top-left corner at one scale', async () => {
    const page = await open(RESIZED, RESIZED_IMAGES);
    const home = await openFullPage(page, HOME);
    await home.getByRole('radio', { name: 'Slider' }).check();

    const point = { x: 1000, y: 600 };
    const before = await screenPoint(
      page,
      `Before: ${HOME}, full page`,
      { width: 1280, height: 800 },
      point,
    );
    const after = await screenPoint(
      page,
      `After: ${HOME}, full page`,
      { width: 1400, height: 800 },
      point,
    );

    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  test('side by side draws Before and After at one scale when their widths differ', async () => {
    const page = await open(RESIZED, RESIZED_IMAGES);
    await openFullPage(page, HOME);

    const before = await offsetOf(
      page,
      `Before: ${HOME}, full page`,
      1280,
      1000,
    );
    const after = await offsetOf(page, `After: ${HOME}, full page`, 1400, 1000);

    expect(after).toBeCloseTo(before, 0);
  });

  test('an arrow key moves the divider by one percent', async () => {
    const page = await open(RESIZED, RESIZED_IMAGES);
    const home = await openFullPage(page, HOME);
    await home.getByRole('radio', { name: 'Slider' }).check();
    const divider = home.getByRole('slider', { name: 'Divider position' });

    await divider.focus();
    await page.keyboard.press('ArrowRight');

    expect(await divider.inputValue()).toBe('51');
  });

  test('moving the divider shows Before up to the divider and After past it', async () => {
    const page = await open(RESIZED, RESIZED_IMAGES);
    await page.setViewportSize({ width: 1280, height: 2400 });
    const home = await openFullPage(page, HOME);
    await home.getByRole('radio', { name: 'Slider' }).check();
    const point = await screenPoint(
      page,
      `Before: ${HOME}, full page`,
      { width: 1280, height: 800 },
      { x: 900, y: 400 },
    );
    expect(await imageAt(page, point)).toBe(`After: ${HOME}, full page`);

    await home.getByRole('slider', { name: 'Divider position' }).fill('90');

    expect(await imageAt(page, point)).toBe(`Before: ${HOME}, full page`);
  });

  test('opening an end line shows the Before and After of its first variant', async () => {
    const page = await open(MIXED, MIXED_IMAGES);
    const before = page.getByRole('img', {
      name: `Before: ${ABOUT}`,
      exact: true,
    });
    expect(await before.count()).toBe(0);

    await page.getByText(ABOUT, { exact: true }).click();

    await expect.poll(() => before.isVisible()).toBe(true);
  });

  test('opening a noise line shows the differences between the two Before loads', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    await page.getByText(NEWS, { exact: true }).click();

    await expect
      .poll(() =>
        page
          .getByRole('img', {
            name: `Differences between the two Before loads: ${NEWS}`,
            exact: true,
          })
          .isVisible(),
      )
      .toBe(true);
  });

  test('a run where nothing changed or failed says so and shows no cards', async () => {
    const page = await open(
      CLEAN,
      new Map([['0-about', { before: PAGE_BEFORE, after: PAGE_BEFORE }]]),
    );

    expect(await page.getByRole('heading', { level: 1 }).textContent()).toBe(
      'No screens changed',
    );
    expect(await page.getByRole('article').count()).toBe(0);
  });

  test('markup in a review string is shown as text and never runs', async () => {
    const page = await open(HOSTILE);

    expect(
      await page
        .getByText(
          '<img src=x onerror="window.pwned = true"></script><!--<script>',
          { exact: true },
        )
        .isVisible(),
    ).toBe(true);
    expect(await page.evaluate(() => 'pwned' in window)).toBe(false);
  });

  test('the title shows a run id with markup as text', async () => {
    const page = await open(HOSTILE);

    expect(await page.title()).toBe(
      'ui-compare · run-</title><script>window.pwned = true</script>',
    );
  });

  test('opening every disclosure and view requests nothing but data: URLs', async () => {
    const page = await newPage();
    const requests = collectNetworkRequests(page);
    await page.setContent(renderReport(MIXED, MIXED_IMAGES));

    await openEverything(page);

    expect(requests).toStrictEqual([]);
  });

  test('opening every disclosure and view logs no console errors', async () => {
    const page = await newPage();
    const errors = collectConsoleErrors(page);
    await page.setContent(renderReport(MIXED, MIXED_IMAGES));

    await openEverything(page);

    expect(errors).toStrictEqual([]);
  });

  test('nothing widens the page at 320px', async () => {
    const long = `http://127.0.0.1:5173/${'segment/'.repeat(12)}?query=${'0123456789abcdef'.repeat(4)}`;
    const page = await open(
      {
        ...MIXED,
        errors: [
          {
            screen: urlScreen(long),
            variants: [variant('0-admin')],
            phase: 'after',
            message: `Failed to load ${long}`,
          },
        ],
        changed: [
          {
            screen: urlScreen(long),
            changes: [
              {
                variants: [
                  variant('1-home', { warnings: [`Failed to load ${long}`] }),
                ],
                crops: [
                  {
                    area: { x: 100, y: 10, width: 1000, height: 20 },
                    box: { x: 0, y: 0, width: 1200, height: 40 },
                    before: png(1200, 40, WHITE),
                    after: png(1200, 40, GRAY),
                  },
                ],
                fullPage: false,
              },
            ],
          },
        ],
      },
      MIXED_IMAGES,
    );
    await page.setViewportSize({ width: 320, height: 640 });

    await openEverything(page);

    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBe(0);
  });
});
