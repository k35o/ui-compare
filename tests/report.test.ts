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
  Change,
  Crop,
  Review,
  Screen,
  ShotImages,
  Variant,
} from '../src/review.ts';

type Rgba = [number, number, number, number];

type Dimensions = NonNullable<Change['dimensions']>;

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

const HOME = 'Home';
const ADMIN = 'Admin';
const NEWS = 'News';
const ABOUT = 'About';

function urlScreen(label: string): Screen {
  const target = `http://127.0.0.1:5173/${encodeURIComponent(label)}`;
  return { key: `url:${target}`, kind: 'url', label, target };
}

function componentScreen(title: string): Screen {
  return {
    key: `component:Components/${title}`,
    kind: 'component',
    label: title,
    target: `Components/${title}`,
  };
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
          marks: [],
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
          marks: [],
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
        {
          variants: [variant('0-wider')],
          crops: [CROP],
          fullPage: false,
          marks: [],
        },
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

  async function newPage(locale = 'en-US', timezoneId = 'UTC'): Promise<Page> {
    const page = await browser.newPage({ locale, timezoneId });
    pages.push(page);
    return page;
  }

  async function open(
    review: Review,
    images: ShotImages = new Map(),
    locale = 'en-US',
    timezoneId = 'UTC',
  ): Promise<Page> {
    const page = await newPage(locale, timezoneId);
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

  test('shows what could not be captured, then what changed, then the others', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    expect(
      await page.getByRole('heading', { level: 2 }).allInnerTexts(),
    ).toStrictEqual(['Not captured', 'Home', 'Button', 'Others']);
  });

  test('lists what changed only where it changes on every load, then what is unchanged, then what was left out', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    expect(
      await page
        .getByRole('region', { name: 'Others' })
        .getByRole('listitem')
        .allInnerTexts(),
    ).toStrictEqual([
      'News 1280px wide\nOnly parts that change on every load (like a clock) changed',
      'About 1280px wide\nUnchanged',
      'Card Loading (1280px wide)\nLeft out: parameters.vrt.skip is set',
    ]);
  });

  test('the other lines read in Japanese', async () => {
    const page = await open(MIXED, MIXED_IMAGES, 'ja-JP');

    expect(
      await page
        .getByRole('region', { name: 'そのほか' })
        .getByRole('listitem')
        .allInnerTexts(),
    ).toStrictEqual([
      'News 幅 1280px\nもともと毎回変わる部分（時計など）だけが変わりました',
      'About 幅 1280px\n変わっていません',
      'Card Loading（幅 1280px）\n撮影しませんでした：parameters.vrt.skip is set',
    ]);
  });

  const NAMES = {
    'en-US': ['Pricing page', 'Settings page', 'Button', 'Header', 'Footer'],
    'ja-JP': ['料金ページ', '設定ページ', 'ボタン', 'ヘッダー', 'フッター'],
  };

  function changedNames(labels: string[]): Review {
    return changedRun(
      'run-names',
      labels.map((label, index) => ({
        screen: urlScreen(label),
        changes: [
          {
            variants: [variant(`${index}-page`)],
            crops: [CROP],
            fullPage: false,
            marks: [],
          },
        ],
      })),
    );
  }

  function failedNames(labels: string[]): Review {
    return {
      ...CLEAN,
      unchanged: [],
      errors: labels.map((label, index) => ({
        screen: urlScreen(label),
        variants: [variant(`${index}-page`)],
        phase: 'after',
        message: 'HTTP 500',
      })),
    };
  }

  async function headline(review: Review, locale: string): Promise<string> {
    const page = await open(review, new Map(), locale);
    return (await page.getByRole('heading', { level: 1 }).textContent()) ?? '';
  }

  async function headlines(
    count: number,
    run: (labels: string[]) => Review,
  ): Promise<string[]> {
    const read = async (locale: keyof typeof NAMES) =>
      headline(run(NAMES[locale].slice(0, count)), locale);
    return [await read('en-US'), await read('ja-JP')];
  }

  test.each([
    {
      count: 1,
      en: 'Pricing page changed',
      ja: '「料金ページ」の見た目が変わりました',
    },
    {
      count: 2,
      en: 'Pricing page and Settings page changed',
      ja: '「料金ページ」と「設定ページ」の見た目が変わりました',
    },
    {
      count: 3,
      en: 'Pricing page, Settings page and Button changed',
      ja: '「料金ページ」「設定ページ」「ボタン」の見た目が変わりました',
    },
    {
      count: 5,
      en: 'Pricing page, Settings page, Button and 2 more changed',
      ja: '「料金ページ」「設定ページ」「ボタン」ほか 2 件の見た目が変わりました',
    },
  ])(
    'the headline names $count changed in order',
    async ({ count, en, ja }) => {
      expect(await headlines(count, changedNames)).toStrictEqual([en, ja]);
    },
  );

  test.each([
    {
      count: 1,
      en: 'Pricing page could not be captured',
      ja: '「料金ページ」を撮影できませんでした',
    },
    {
      count: 2,
      en: 'Pricing page and Settings page could not be captured',
      ja: '「料金ページ」と「設定ページ」を撮影できませんでした',
    },
    {
      count: 3,
      en: 'Pricing page, Settings page and Button could not be captured',
      ja: '「料金ページ」「設定ページ」「ボタン」を撮影できませんでした',
    },
    {
      count: 5,
      en: 'Pricing page, Settings page, Button and 2 more could not be captured',
      ja: '「料金ページ」「設定ページ」「ボタン」ほか 2 件を撮影できませんでした',
    },
  ])(
    'when nothing changed, the headline names $count that could not be captured',
    async ({ count, en, ja }) => {
      expect(await headlines(count, failedNames)).toStrictEqual([en, ja]);
    },
  );

  test('the headline names what could not be captured once, however many errors it had', async () => {
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
      'Admin could not be captured',
    );
  });

  test.each([
    { locale: 'en-US', text: 'Nothing looks different' },
    { locale: 'ja-JP', text: '見た目は変わっていません' },
  ])(
    'a run where nothing changed says so in $locale',
    async ({ locale, text }) => {
      expect(await headline(CLEAN, locale)).toBe(text);
    },
  );

  test.each([
    { locale: 'en-US', text: 'Nothing was captured' },
    { locale: 'ja-JP', text: '撮影したものはありません' },
  ])(
    'a run without shots says nothing was captured in $locale',
    async ({ locale, text }) => {
      expect(await headline({ ...CLEAN, unchanged: [] }, locale)).toBe(text);
    },
  );

  test('the sentence under the headline counts the others in English', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    expect(await page.locator('.lead').textContent()).toBe(
      'Also 1 not captured, 1 changed only where it changes on every load, 1 unchanged and 1 left out.',
    );
  });

  test('the sentence under the headline counts the others in Japanese', async () => {
    const page = await open(MIXED, MIXED_IMAGES, 'ja-JP');

    expect(await page.locator('.lead').textContent()).toBe(
      'ほかに、撮影できなかったもの 1 件、毎回変わる部分だけが変わったもの 1 件、変わらなかったもの 1 件、撮影しなかったもの 1 件があります',
    );
  });

  test('the sentence under the headline counts what had several errors once', async () => {
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
      'Also 1 not captured.',
    );
  });

  test('the sentence under the headline does not count what changed again', async () => {
    const page = await open({
      ...changedRun('run-partly', MIXED.changed.slice(0, 1)),
      errors: [
        {
          screen: urlScreen(HOME),
          variants: [
            variant('6-home', { viewport: { width: 320, height: 640 } }),
          ],
          phase: 'after',
          message: 'HTTP 500',
        },
      ],
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

    expect(await page.locator('.lead').textContent()).toBe('Also 1 unchanged.');
  });

  test('the sentence under the headline leaves out what could not be captured when nothing changed', async () => {
    const page = await open({
      ...failedNames([ADMIN]),
      unchanged: [{ screen: urlScreen(ABOUT), variants: [variant('5-about')] }],
    });

    expect(await page.locator('.lead').textContent()).toBe('Also 1 unchanged.');
  });

  test('a run where only the headline has something to say has no sentence under it', async () => {
    const page = await open(changedNames([HOME]));

    expect(await page.locator('.lead').count()).toBe(0);
  });

  async function overview(review: Review, locale: string): Promise<string[]> {
    const page = await open(review, new Map(), locale);
    return [
      (await page.getByRole('heading', { level: 1 }).textContent()) ?? '',
      (await page.locator('.lead').textContent()) ?? '',
    ];
  }

  test.each([
    {
      what: 'only what was left out',
      review: { ...CLEAN, unchanged: [], skipped: MIXED.skipped },
      en: ['Nothing was captured', '1 left out.'],
      ja: ['撮影したものはありません', '撮影しなかったもの 1 件があります'],
    },
    {
      what: 'what is unchanged and what was left out, without "Also"',
      review: {
        ...CLEAN,
        unchanged: [ADMIN, NEWS, ABOUT].map((label, index) => ({
          screen: urlScreen(label),
          variants: [variant(`${index}-page`)],
        })),
        skipped: MIXED.skipped,
      },
      en: ['Nothing looks different', '3 unchanged and 1 left out.'],
      ja: [
        '見た目は変わっていません',
        '変わらなかったもの 3 件、撮影しなかったもの 1 件があります',
      ],
    },
    {
      what: 'two that changed only where they change on every load',
      review: {
        ...CLEAN,
        unchanged: [],
        noise: [NEWS, HOME].map((label, index) => ({
          screen: urlScreen(label),
          variants: [variant(`${index}-page`)],
        })),
      },
      en: [
        'Nothing looks different',
        '2 changed only where they change on every load.',
      ],
      ja: [
        '見た目は変わっていません',
        '毎回変わる部分だけが変わったもの 2 件があります',
      ],
    },
  ])(
    'when nothing changed or failed, the headline and the sentence under it count $what',
    async ({ review, en, ja }) => {
      expect([
        await overview(review, 'en-US'),
        await overview(review, 'ja-JP'),
      ]).toStrictEqual([en, ja]);
    },
  );

  test('what could not be captured is not counted again among what changes on every load', async () => {
    const page = await open({
      ...changedRun('run-failed-noise', MIXED.changed.slice(0, 1)),
      errors: MIXED.errors,
      noise: [
        {
          screen: urlScreen(ADMIN),
          variants: [
            variant('7-admin', { viewport: { width: 375, height: 812 } }),
          ],
        },
      ],
    });

    expect(await page.locator('.lead').textContent()).toBe(
      'Also 1 not captured.',
    );
  });

  test('a component with one story unchanged and another left out is counted once, as unchanged', async () => {
    const screen = componentScreen('Card');
    const page = await open({
      ...CLEAN,
      unchanged: [
        { screen, variants: [variant('0-card', { story: 'Default' })] },
      ],
      skipped: [
        {
          screen,
          variants: [variant('1-card', { story: 'Loading' })],
          reason: 'parameters.vrt.skip is set',
        },
      ],
    });

    expect(await page.locator('.lead').textContent()).toBe('1 unchanged.');
  });

  async function timesLine(
    beforeAt: string,
    afterAt: string,
    locale: string,
    timezoneId = 'UTC',
  ): Promise<string> {
    const page = await open(
      { ...CLEAN, beforeAt, afterAt },
      new Map(),
      locale,
      timezoneId,
    );
    return (await page.locator('.eyebrow').textContent()) ?? '';
  }

  test.each([
    {
      what: 'on one day as clocks',
      beforeAt: '2026-11-23T10:02:00.000Z',
      afterAt: '2026-11-23T10:15:00.000Z',
      en: 'Before 10:02 · After 10:15',
      ja: '変更前 10:02 · 変更後 10:15',
    },
    {
      what: 'on two days with their dates',
      beforeAt: '2026-11-23T10:02:00.000Z',
      afterAt: '2026-11-24T10:15:00.000Z',
      en: 'Before Nov 23 10:02 · After Nov 24 10:15',
      ja: '変更前 11月23日 10:02 · 変更後 11月24日 10:15',
    },
    {
      what: 'in the morning without a leading zero',
      beforeAt: '2026-11-23T08:00:00.000Z',
      afterAt: '2026-11-23T08:05:00.000Z',
      en: 'Before 8:00 · After 8:05',
      ja: '変更前 8:00 · 変更後 8:05',
    },
    {
      what: 'that cannot be read as given',
      beforeAt: 'yesterday',
      afterAt: '2026-11-24T10:15:00.000Z',
      en: 'Before yesterday · After Nov 24 10:15',
      ja: '変更前 yesterday · 変更後 11月24日 10:15',
    },
  ])(
    'the line above the headline gives the times of Before and After $what',
    async ({ beforeAt, afterAt, en, ja }) => {
      expect([
        await timesLine(beforeAt, afterAt, 'en-US'),
        await timesLine(beforeAt, afterAt, 'ja-JP'),
      ]).toStrictEqual([en, ja]);
    },
  );

  test('Before and After on one local day but two UTC days are given as clocks', async () => {
    expect(
      await timesLine(
        '2026-11-23T23:30:00.000Z',
        '2026-11-24T00:10:00.000Z',
        'en-US',
        'Asia/Tokyo',
      ),
    ).toBe('Before 8:30 · After 9:10');
  });

  test('a Japanese report declares its language', async () => {
    const page = await open(MIXED, MIXED_IMAGES, 'ja-JP');

    expect(await page.locator('html').getAttribute('lang')).toBe('ja');
  });

  test('what could not be captured shows its name, its variants, the phase and the message', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    expect(
      await page
        .getByRole('region', { name: 'Not captured' })
        .getByRole('article')
        .ariaSnapshot(),
    ).toBe(
      [
        '- article:',
        '  - heading "Admin" [level=3]',
        '  - paragraph: 1280px wide · Failed while capturing After',
        '  - paragraph: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:5173/admin',
      ].join('\n'),
    );
  });

  test('what could not be captured reads in Japanese', async () => {
    const page = await open(MIXED, MIXED_IMAGES, 'ja-JP');

    expect(
      await page
        .getByRole('region', { name: '撮影できなかったもの' })
        .getByRole('paragraph')
        .first()
        .textContent(),
    ).toBe('幅 1280px · 変更後の撮影で失敗');
  });

  test('a change seen at several viewports lists them once', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    expect(
      await card(page, HOME).getByRole('heading', { level: 3 }).allInnerTexts(),
    ).toStrictEqual(['1280px and 375px wide']);
  });

  const DESKTOP = { width: 1280, height: 720 };
  const TABLET = { width: 768, height: 1024 };
  const MOBILE = { width: 375, height: 812 };
  const TALL = { width: 1280, height: 900 };

  async function sameChangeNote(
    viewports: Array<Variant['viewport']>,
    locale: string,
  ): Promise<string> {
    const page = await open(
      changedRun('run-same', [
        {
          screen: urlScreen(HOME),
          changes: [
            {
              variants: viewports.map((viewport, index) =>
                variant(`${index}-home`, { viewport }),
              ),
              crops: [CROP],
              fullPage: false,
              marks: [],
            },
          ],
        },
      ]),
      new Map(),
      locale,
    );
    return (await card(page, HOME).locator('.note').textContent()) ?? '';
  }

  test.each([
    {
      count: 2,
      viewports: [DESKTOP, MOBILE],
      en: 'Both changed the same way.',
      ja: 'どちらも同じ変わり方です',
    },
    {
      count: 3,
      viewports: [DESKTOP, TABLET, MOBILE],
      en: 'They all changed the same way.',
      ja: 'どれも同じ変わり方です',
    },
  ])(
    'a change seen at $count viewports says they changed the same way',
    async ({ viewports, en, ja }) => {
      expect([
        await sameChangeNote(viewports, 'en-US'),
        await sameChangeNote(viewports, 'ja-JP'),
      ]).toStrictEqual([en, ja]);
    },
  );

  test('a Japanese report describes each image by its kind, name and detail', async () => {
    const page = await open(MIXED, MIXED_IMAGES, 'ja-JP');

    expect(
      await page
        .getByRole('img')
        .evaluateAll((images) =>
          images.map((image) => image.getAttribute('alt')),
        ),
    ).toStrictEqual([
      '変更前：Home',
      '変更後：Home',
      '変更前：Button、ページ全体',
      '変更後：Button、ページ全体',
    ]);
  });

  async function changeHeading(
    screen: Screen,
    variants: Variant[],
    locale: string,
  ): Promise<string> {
    const page = await open(
      changedRun('run-heading', [
        {
          screen,
          changes: [{ variants, crops: [CROP], fullPage: false, marks: [] }],
        },
      ]),
      new Map(),
      locale,
    );
    return (
      (await card(page, screen.label)
        .getByRole('heading', { level: 3 })
        .textContent()) ?? ''
    );
  }

  test.each([
    {
      what: 'three widths',
      screen: urlScreen(HOME),
      variants: [
        variant('0', { viewport: DESKTOP }),
        variant('1', { viewport: TABLET }),
        variant('2', { viewport: MOBILE }),
      ],
      en: '1280px, 768px and 375px wide',
      ja: '幅 1280px、768px、375px',
    },
    {
      what: 'two heights at one width',
      screen: urlScreen(HOME),
      variants: [
        variant('0', { viewport: DESKTOP }),
        variant('1', { viewport: TALL }),
      ],
      en: '1280×720 and 1280×900',
      ja: '1280×720 と 1280×900',
    },
    {
      what: 'two heights at one width and another width',
      screen: urlScreen(HOME),
      variants: [
        variant('0', { viewport: DESKTOP }),
        variant('1', { viewport: TALL }),
        variant('2', { viewport: MOBILE }),
      ],
      en: '1280×720, 1280×900 and 375px wide',
      ja: '1280×720、1280×900、幅 375px',
    },
    {
      what: 'the dark color scheme',
      screen: urlScreen(HOME),
      variants: [variant('0', { colorScheme: 'dark' })],
      en: '1280px wide, dark mode',
      ja: '幅 1280px、ダークモード',
    },
    {
      what: 'both color schemes',
      screen: urlScreen(HOME),
      variants: [variant('0'), variant('1', { colorScheme: 'dark' })],
      en: '1280px wide, light and dark mode',
      ja: '幅 1280px、ライトモードとダークモード',
    },
    {
      what: 'a story in dark mode',
      screen: componentScreen('Button'),
      variants: [variant('0', { story: 'Primary', colorScheme: 'dark' })],
      en: 'Primary (1280px wide, dark mode)',
      ja: 'Primary（幅 1280px、ダークモード）',
    },
    {
      what: 'two stories at two widths',
      screen: componentScreen('Button'),
      variants: [
        variant('0', { story: 'Primary' }),
        variant('1', { story: 'Primary', viewport: MOBILE }),
        variant('2', { story: 'Secondary' }),
        variant('3', { story: 'Secondary', viewport: MOBILE }),
      ],
      en: 'Primary and Secondary (1280px and 375px wide)',
      ja: 'Primary と Secondary（幅 1280px と 375px）',
    },
    {
      what: 'two stories at a width each',
      screen: componentScreen('Button'),
      variants: [
        variant('0', { story: 'Primary' }),
        variant('1', { story: 'Secondary', viewport: MOBILE }),
      ],
      en: 'Primary (1280px wide) and Secondary (375px wide)',
      ja: 'Primary（幅 1280px）、Secondary（幅 375px）',
    },
    {
      what: 'two stories in a color scheme each',
      screen: componentScreen('Button'),
      variants: [
        variant('0', { story: 'Primary' }),
        variant('1', { story: 'Secondary', colorScheme: 'dark' }),
      ],
      en: 'Primary (1280px wide) and Secondary (1280px wide, dark mode)',
      ja: 'Primary（幅 1280px）、Secondary（幅 1280px、ダークモード）',
    },
    {
      what: 'a width in each color scheme',
      screen: urlScreen(HOME),
      variants: [
        variant('0'),
        variant('1', { viewport: MOBILE, colorScheme: 'dark' }),
      ],
      en: '1280px wide and 375px wide (dark mode)',
      ja: '幅 1280px、幅 375px（ダークモード）',
    },
  ])('a change heading names $what', async ({ screen, variants, en, ja }) => {
    expect([
      await changeHeading(screen, variants, 'en-US'),
      await changeHeading(screen, variants, 'ja-JP'),
    ]).toStrictEqual([en, ja]);
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
              marks: [],
            },
          ],
        },
      ]),
    );

    expect(
      await card(page, HOME).getByRole('listitem').allInnerTexts(),
    ).toStrictEqual(['Note: Vite reported an error on another page']);
  });

  async function pageSizeNote(
    dimensions: Dimensions,
    locale: string,
  ): Promise<string> {
    const page = await open(
      changedRun('run-resized', [
        {
          screen: urlScreen(HOME),
          changes: [
            {
              variants: [variant('0-home')],
              crops: [CROP],
              fullPage: false,
              marks: [],
              dimensions,
            },
          ],
        },
      ]),
      new Map(),
      locale,
    );
    return (await card(page, HOME).locator('.note').textContent()) ?? '';
  }

  test.each<{ what: string; dimensions: Dimensions; en: string; ja: string }>([
    {
      what: 'height',
      dimensions: { before: [1280, 720], after: [1280, 1100] },
      en: 'The page height changed from 720px to 1100px.',
      ja: 'ページの高さが 720px から 1100px に変わりました',
    },
    {
      what: 'size',
      dimensions: { before: [1280, 720], after: [1000, 1000] },
      en: 'The page size changed from 1280×720 to 1000×1000.',
      ja: 'ページの大きさが 1280×720 から 1000×1000 に変わりました',
    },
  ])(
    'a change that resized the page tells how its $what changed',
    async ({ dimensions, en, ja }) => {
      expect([
        await pageSizeNote(dimensions, 'en-US'),
        await pageSizeNote(dimensions, 'ja-JP'),
      ]).toStrictEqual([en, ja]);
    },
  );

  test('a story change shows a Storybook tag', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    expect(
      await card(page, 'Button')
        .getByText('Storybook', { exact: true })
        .isVisible(),
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
              marks: [],
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
              marks: [],
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

  test.each([
    { locale: 'en-US', labels: ['Spot 1 of 2', 'Spot 2 of 2'] },
    {
      locale: 'ja-JP',
      labels: ['1 か所目（全 2 か所）', '2 か所目（全 2 か所）'],
    },
  ])(
    'each spot of a change with two crops is numbered in $locale',
    async ({ locale, labels }) => {
      const page = await open(
        changedRun('run-two-areas', [
          {
            screen: urlScreen(HOME),
            changes: [
              {
                variants: [variant('0-home')],
                crops: [CROP, { ...CROP, box: { ...CROP.box, y: 400 } }],
                fullPage: false,
                marks: [],
              },
            ],
          },
        ]),
        new Map(),
        locale,
      );

      expect(
        await card(page, HOME).locator('.area-label').allInnerTexts(),
      ).toStrictEqual(labels);
    },
  );

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
              marks: [],
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

  test('View full page reads Close while the full page is open', async () => {
    const page = await open(MIXED, MIXED_IMAGES);

    const home = await openFullPage(page, HOME);

    expect(await home.locator('summary').allInnerTexts()).toStrictEqual([
      'Close',
    ]);
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
            name: `Difference between the two Before loads: ${NEWS}`,
            exact: true,
          })
          .isVisible(),
      )
      .toBe(true);
  });

  test('a run where nothing changed or failed shows no cards', async () => {
    const page = await open(
      CLEAN,
      new Map([['0-about', { before: PAGE_BEFORE, after: PAGE_BEFORE }]]),
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
                marks: [],
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
