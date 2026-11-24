import type { On } from 'claude-code';
import { expect, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';

import type { ReviewFile, ReviewPage } from '../hooks/review-file';
import { image, localTime, PANE, PIXEL, REVIEW, RUN } from './fixture';

type World = {
  language?: string;
  base64Of?: (path: string) => string | undefined;
  review?: { mtimeMs: number };
  text?: string;
};

type Seen = { reads: string[]; toasts: string[] };

type Drawn = {
  props: Record<string, unknown>;
  hover?: Record<string, unknown>;
};

function world(
  on: On,
  {
    language,
    base64Of,
    review = { mtimeMs: 5000 },
    text = JSON.stringify(REVIEW),
  }: World = {},
): Seen {
  const seen: Seen = { reads: [], toasts: [] };
  on('settings.read', () => ({
    value: language === undefined ? {} : { language },
  }));
  on('fs.list', () => ({
    value: [{ name: RUN, kind: 'dir', size: 0, mtimeMs: 0, isLink: false }],
  }));
  on('fs.stat', () => ({
    value: { kind: 'file', size: 1, mtimeMs: review.mtimeMs, isLink: false },
  }));
  on('fs.read', (_, e) => {
    seen.reads.push(e.path);
    return e.as === 'bytes'
      ? { value: { base64: base64Of?.(e.path) ?? PIXEL } }
      : { value: text };
  });
  on('ui.open', () => ({ value: { isPlaced: true } }));
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text);
    return { value: undefined };
  });
  return seen;
}

async function showLatestRun($: Engine): Promise<void> {
  await $.command.run({
    command: 'ui-compare-pane',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 200 },
  });
}

type Found = { props: Record<string, unknown> };

async function layers(
  ui: { findAll: (query: { type: string }) => Promise<Found[]> },
  label: string,
) {
  const svgs = await ui.findAll({ type: 'Svg' });
  const sourcesOf = (kind: string) =>
    svgs
      .filter(({ props }) => props.alt === `${kind}: ${label}, full page`)
      .map(({ props }) => String(props.source));
  return { before: sourcesOf('Before'), after: sourcesOf('After') };
}

function frame(sources: readonly string[]) {
  const sizes = sources.map((source) => {
    const [, width, height] =
      /^<svg [^>]*?width="([^"]+)" height="([^"]+)"/.exec(source) ?? [];
    return { width: Number(width), height: Number(height) };
  });
  return {
    widths: [...new Set(sizes.map(({ width }) => width))],
    height: sizes.reduce((sum, { height }) => sum + height, 0),
  };
}

function withHomePage(page: ReviewPage): ReviewFile {
  return {
    ...REVIEW,
    changed: REVIEW.changed.map((screen, index) =>
      index === 0
        ? {
            ...screen,
            changes: screen.changes.map((change) => ({ ...change, page })),
          }
        : screen,
    ),
  };
}

async function texts(ui: {
  findAll: (query: { type: string }) => Promise<Array<{ text: string }>>;
}) {
  return (await ui.findAll({ type: 'Text' })).map(({ text }) => text);
}

test('the header names what changed and counts the rest', async ($, on) => {
  world(on);
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect(await texts(ui)).toEqual(
    expect.arrayContaining([
      'Home, Button and Pricing page changed',
      'Also 1 not captured, 1 changed only where it changes on every load, 1 unchanged and 1 left out.',
    ]),
  );
  await ui.unmount();
});

test('the close button closes the pane, also in its small form', async ($, on) => {
  world(on);
  const closed: string[] = [];
  on('ui.close', (_, e) => {
    closed.push(e.id);
    return { value: undefined };
  });
  await showLatestRun($);

  for (const placement of ['dock', 'widget'] as const) {
    const ui = await $.ui.mount({
      ...PANE,
      surface: 'desktop',
      props: { ...PANE.props, placement },
    });
    const close = await ui.find({ key: 'close' });
    expect(close?.props.role).toBe('dismiss');
    expect(close?.text).toBe('Close');
    await ui.press({ key: 'close' });
    await ui.unmount();
  }

  expect(closed).toEqual(['ui-compare', 'ui-compare']);
});

test('the empty pane has a close button too', async ($, on) => {
  world(on, { text: '{}' });
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect((await ui.find({ key: 'close' }))?.props.role).toBe('dismiss');
  await ui.unmount();
});

test('the header gives the capture times without the run id', async ($, on) => {
  world(on);
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const shown = await texts(ui);

  expect(shown).toContain('Before 10:02 · After 10:15');
  expect(shown.filter((text) => text.includes(RUN))).toEqual([]);
  await ui.unmount();
});

test('capture times on different days carry their dates', async ($, on) => {
  const text = JSON.stringify({
    ...REVIEW,
    beforeAt: localTime(11, 23, 10, 2),
    afterAt: localTime(11, 24, 10, 15),
  });
  world(on, { text });
  await showLatestRun($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect(await texts(ui)).toContain('Before Nov 23 10:02 · After Nov 24 10:15');
  await ui.unmount();
});

test('Japanese capture times on different days carry their dates', async ($, on) => {
  const text = JSON.stringify({
    ...REVIEW,
    beforeAt: localTime(11, 23, 10, 2),
    afterAt: localTime(11, 24, 10, 15),
  });
  world(on, { language: 'ja', text });
  await showLatestRun($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect(await texts(ui)).toContain(
    '変更前 11月23日 10:02 · 変更後 11月24日 10:15',
  );
  await ui.unmount();
});

test('what could not be captured comes before what changed', async ($, on) => {
  world(on);
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const shown = await texts(ui);

  expect(shown.indexOf('Not captured')).toBeLessThan(shown.indexOf('Home'));
  expect(shown).toEqual(
    expect.arrayContaining([
      'Checkout',
      '1280px wide',
      'Failed while capturing After',
      'net::ERR_CONNECTION_REFUSED',
    ]),
  );
  await ui.unmount();
});

test('a crop shows Before above After, each outlined in red around the changed area', async ($, on) => {
  world(on);
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const [before, after] = await ui.findAll({ type: 'Svg' });

  expect(before?.props.alt).toBe('Before: Home');
  expect(after?.props.alt).toBe('After: Home');
  for (const svg of [before, after]) {
    expect(String(svg?.props.source)).toContain(
      `href="data:image/png;base64,${PIXEL}"`,
    );
    expect(String(svg?.props.source)).toContain(
      '<rect x="44" y="56" width="128" height="48" rx="2" fill="none" stroke="#e5484d" stroke-width="2"/>',
    );
  }
  await ui.unmount();
});

test('a change with several spots numbers each and describes its variants', async ($, on) => {
  world(on);
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect(await texts(ui)).toEqual(
    expect.arrayContaining([
      'Storybook',
      'Primary (1280px wide, light and dark mode)',
      'Both changed the same way.',
      'Note: Fonts were still loading',
      'Spot 1 of 2',
      'Spot 2 of 2',
    ]),
  );
  await ui.unmount();
});

test('a full-page change shows the page and its size change without a toggle', async ($, on) => {
  world(on);
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const pages = (await ui.findAll({ type: 'Svg' })).filter(
    ({ props }) => props.alt === 'After: Pricing page, full page',
  );

  expect(pages).toHaveLength(2);
  expect(await texts(ui)).toContain(
    'The page height changed from 720px to 1100px.',
  );
  expect(await ui.find({ key: 'page:change:2:0' })).toBeUndefined();
  await ui.unmount();
});

test('Others lists what changed only where it always changes, stayed the same or was left out', async ($, on) => {
  world(on);
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const shown = await texts(ui);

  expect(shown.indexOf('Others')).toBeGreaterThan(
    shown.indexOf('Pricing page'),
  );
  expect(shown).toEqual(
    expect.arrayContaining([
      'Clock',
      'Only parts that change on every load (like a clock) changed',
      'About',
      'Unchanged',
      'Admin',
      'Left out: Redirected to a login page',
    ]),
  );
  expect((await ui.find({ key: 'page:noise:0' }))?.props.label).toBe(
    'View full page',
  );
  expect(await ui.find({ key: 'page:skipped:0' })).toBeUndefined();
  await ui.unmount();
});

test('View full page shows the After page, with Before under the pointer', async ($, on) => {
  world(on);
  await showLatestRun($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  await ui.press({ key: 'page:change:0:0' });
  const swap = await ui.find({ key: 'swap:change:0:0' });
  const overlay = (swap?.children as Drawn[] | undefined)?.find(
    ({ props }) => props.position === 'absolute',
  );

  expect(swap?.props.position).toBe('relative');
  expect(overlay).toMatchObject({
    props: { top: 0, left: 0, display: 'none' },
    hover: { display: 'flex' },
  });
  expect(
    (await ui.findAll({ type: 'Svg' }))
      .filter(({ props }) => String(props.alt).endsWith(': Home, full page'))
      .map(({ props }) => props.alt),
  ).toEqual([
    'After: Home, full page',
    'After: Home, full page',
    'Before: Home, full page',
  ]);
  expect((await ui.find({ key: 'page:change:0:0' }))?.props.label).toBe(
    'Close',
  );
  expect(await texts(ui)).toContain(
    'This is After. Point at it to see Before.',
  );
  await ui.unmount();
});

test('pressing View full page again hides the page', async ($, on) => {
  world(on);
  await showLatestRun($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  await ui.press({ key: 'page:change:0:0' });
  await ui.press({ key: 'page:change:0:0' });

  expect(await ui.find({ key: 'swap:change:0:0' })).toBeUndefined();
  expect((await ui.find({ key: 'page:change:0:0' }))?.props.label).toBe(
    'View full page',
  );
  await ui.unmount();
});

test('Not intended appends a draft naming the run, the thing by name and target, its spots and images', async ($, on) => {
  world(on);
  const fills: Array<{ text: string; mode: string }> = [];
  on('prompt.read', () => ({
    value: { text: 'Also check the footer', cursor: 21 },
  }));
  on('prompt.fill', (_, e) => {
    fills.push({ text: e.text, mode: e.mode });
    return { isFilled: true, text: e.text, cursor: e.text.length };
  });
  await showLatestRun($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  await ui.press({ key: 'draft:change:0:0' });

  expect(fills).toEqual([
    {
      mode: 'append',
      text: [
        '',
        '',
        'ui-compare run abc123 shows a change I did not intend.',
        'What changed: Home (http://localhost:5173/)',
        'Seen at: 1280px wide',
        'Changed spots (page coordinates): x=100 y=200 120×40',
        'Image with the changed pixels in red: .ui-compare/abc123/diff/home.png',
        'After image: .ui-compare/abc123/review/home-crop-after-0.png',
        'Find what caused it and fix it.',
        '',
      ].join('\n'),
    },
  ]);
  await ui.unmount();
});

test('Not intended turns into a note once the draft is in the prompt', async ($, on) => {
  world(on);
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }));
  on('prompt.fill', (_, e) => ({
    isFilled: true,
    text: e.text,
    cursor: e.text.length,
  }));
  await showLatestRun($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  await ui.press({ key: 'draft:change:0:0' });

  expect(await ui.find({ key: 'draft:change:0:0' })).toBeUndefined();
  expect(await texts(ui)).toContain(
    'Added to your message. Send it to have it fixed.',
  );
  expect(await ui.find({ key: 'draft:change:1:0' })).toBeDefined();
  await ui.unmount();
});

test('a newer review of the run starts with nothing added or opened', async ($, on) => {
  const review = { mtimeMs: 5000 };
  world(on, { review });
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }));
  on('prompt.fill', (_, e) => ({
    isFilled: true,
    text: e.text,
    cursor: e.text.length,
  }));
  await showLatestRun($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  await ui.press({ key: 'draft:change:0:0' });
  await ui.press({ key: 'page:change:0:0' });

  review.mtimeMs = 9000;
  await showLatestRun($);

  expect((await ui.find({ key: 'draft:change:0:0' }))?.props.label).toBe(
    'Not intended',
  );
  expect((await ui.find({ key: 'page:change:0:0' }))?.props.label).toBe(
    'View full page',
  );
  await ui.unmount();
});

test('a full-page change drafts its page spots, its new height and the After strip that holds them', async ($, on) => {
  world(on);
  const fills: string[] = [];
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }));
  on('prompt.fill', (_, e) => {
    fills.push(e.text);
    return { isFilled: true, text: e.text, cursor: e.text.length };
  });
  await showLatestRun($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  await ui.press({ key: 'draft:change:2:0' });

  expect(fills[0]).toContain(
    'Changed spots (page coordinates): x=0 y=700 1280×400\n',
  );
  expect(fills[0]).toContain('The page height changed from 720px to 1100px.\n');
  expect(fills[0]).toContain(
    'After image: .ui-compare/abc123/review/pricing-after-1.png\n',
  );
  await ui.unmount();
});

test('the pane speaks Japanese when the language setting is Japanese', async ($, on) => {
  world(on, { language: 'japanese' });
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect(await texts(ui)).toEqual(
    expect.arrayContaining([
      '変更前 10:02 · 変更後 10:15',
      '「Home」「Button」「Pricing page」の見た目が変わりました',
      'ほかに、撮影できなかったもの 1 件、毎回変わる部分だけが変わったもの 1 件、変わらなかったもの 1 件、撮影しなかったもの 1 件があります',
      '撮影できなかったもの',
      '変更後の撮影で失敗',
      '変更前',
      '変更後',
      'Primary（幅 1280px、ライトモードとダークモード）',
      'どちらも同じ変わり方です',
      '注意：Fonts were still loading',
      '1 か所目（全 2 か所）',
      'ページの高さが 720px から 1100px に変わりました',
      'そのほか',
      'もともと毎回変わる部分（時計など）だけが変わりました',
      '変わっていません',
      '撮影しませんでした：Redirected to a login page',
    ]),
  );
  expect((await ui.find({ key: 'page:change:0:0' }))?.props.label).toBe(
    'ページ全体を見る',
  );
  expect((await ui.find({ key: 'draft:change:0:0' }))?.props.label).toBe(
    '意図していない',
  );
  expect((await ui.findAll({ type: 'Svg' }))[2]?.props.alt).toBe(
    '変更前：Button、1 か所目（全 2 か所）',
  );
  await ui.unmount();
});

test('the Japanese draft names the thing in brackets with its target', async ($, on) => {
  world(on, { language: 'ja' });
  const fills: string[] = [];
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }));
  on('prompt.fill', (_, e) => {
    fills.push(e.text);
    return { isFilled: true, text: e.text, cursor: e.text.length };
  });
  await showLatestRun($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  await ui.press({ key: 'draft:change:0:0' });

  expect(fills).toEqual([
    [
      'ui-compare の実行 abc123 に意図していない変化があります。',
      '変わったもの：「Home」（http://localhost:5173/）',
      '表示：幅 1280px',
      '変わった場所（ページ上の座標）：x=100 y=200 120×40',
      '変わったピクセルを赤で示した画像：.ui-compare/abc123/diff/home.png',
      '変更後の画像：.ui-compare/abc123/review/home-crop-after-0.png',
      '原因を調べて直してください。',
      '',
    ].join('\n'),
  ]);
  expect(await texts(ui)).toContain(
    '入力欄に書きました。送ると直してもらえます',
  );
  await ui.unmount();
});

test('the terminal, VS Code and mobile get a text summary without pictures', async ($, on) => {
  world(on);
  await showLatestRun($);

  for (const surface of ['terminal', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });

    expect(await ui.findAll({ type: 'Svg' })).toEqual([]);
    expect(await texts(ui)).toEqual([
      'Before 10:02 · After 10:15',
      'Home, Button and Pricing page changed',
      'Also 1 not captured, 1 changed only where it changes on every load, 1 unchanged and 1 left out.',
      ' ',
      'Not captured',
      '  Checkout · 1280px wide',
      '    Failed while capturing After: net::ERR_CONNECTION_REFUSED',
      ' ',
      'Home',
      '  1280px wide',
      ' ',
      'Button (Storybook)',
      '  Primary (1280px wide, light and dark mode)',
      '    Both changed the same way.',
      '    Note: Fonts were still loading',
      ' ',
      'Pricing page',
      '  1280px wide',
      '    The page height changed from 720px to 1100px.',
      ' ',
      'Others',
      '  Clock · 1280px wide',
      '    Only parts that change on every load (like a clock) changed',
      '  About · 1280px wide',
      '    Unchanged',
      '  Admin · 1280px wide',
      '    Left out: Redirected to a login page',
      ' ',
      'Pictures are shown in Claude Code Desktop.',
    ]);
    await ui.unmount();
  }
});

test('a picture too large for one Svg is named in text instead', async ($, on) => {
  world(on, {
    base64Of: (path) =>
      path.endsWith('home-crop-after-0.png') ? 'A'.repeat(131_072) : undefined,
  });
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const sources = (await ui.findAll({ type: 'Svg' })).map(({ props }) =>
    String(props.source),
  );

  expect(await texts(ui)).toContain(
    'Too large to draw here: .ui-compare/abc123/review/home-crop-after-0.png',
  );
  expect(sources.every((source) => source.length <= 131_072)).toBe(true);
  expect(sources.some((source) => source.includes('AAAAAAAA'))).toBe(false);
  await ui.unmount();
});

test('the pane says so while no run has been shown', async ($, on) => {
  world(on);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect(await texts(ui)).toEqual(['No ui-compare result to show yet.']);
  await ui.unmount();
});

test('a shorter Before is drawn as tall as After, so pointing at the page hides After entirely', async ($, on) => {
  world(on);
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const { before, after } = await layers(ui, 'Pricing page');

  expect(before).toHaveLength(1);
  expect(after).toHaveLength(2);
  expect(frame(before)).toEqual(frame(after));
  expect(before[0]).toMatch(
    /<rect width="1280" height="1100" fill="#[0-9a-f]{6}"\/>/,
  );
  await ui.unmount();
});

test('a taller, wider Before does not spill out of the frame After sets', async ($, on) => {
  world(on, {
    text: JSON.stringify(
      withHomePage({
        before: image('home-before', 1280, [800, 700]),
        after: image('home-after', 1000, [600, 400]),
        marks: [],
      }),
    ),
  });
  await showLatestRun($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  await ui.press({ key: 'page:change:0:0' });
  const { before, after } = await layers(ui, 'Home');

  expect(frame(after)).toEqual(frame(before));
  expect(frame(after).widths).toHaveLength(1);
  expect(after[0]).toMatch(
    /<rect width="1280" height="600" fill="#[0-9a-f]{6}"\/>/,
  );
  expect(after[1]).toMatch(
    /<rect width="1280" height="900" fill="#[0-9a-f]{6}"\/>/,
  );
  await ui.unmount();
});

test('Not intended stays when the prompt refuses the draft, and a toast says so', async ($, on) => {
  const seen = world(on);
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }));
  on('prompt.fill', () => ({ isFilled: false }));
  await showLatestRun($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  await ui.press({ key: 'draft:change:0:0' });

  expect(seen.toasts).toEqual(['Could not add it to your message.']);
  expect((await ui.find({ key: 'draft:change:0:0' }))?.props.label).toBe(
    'Not intended',
  );
  expect(await texts(ui)).not.toContain(
    'Added to your message. Send it to have it fixed.',
  );
  await ui.unmount();
});

const UNREADABLE = 'Could not read the ui-compare result.';

test('a review with a path out of its run folder is not read from', async ($, on) => {
  const seen = world(on, {
    text: JSON.stringify(REVIEW).replace(
      'review/home-crop-before-0.png',
      'review/../../../.ssh/id_rsa.png',
    ),
  });
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect(await texts(ui)).toEqual([UNREADABLE]);
  expect(await ui.findAll({ type: 'Svg' })).toEqual([]);
  expect(seen.reads).toEqual([
    expect.stringMatching(/\/\.ui-compare\/abc123\/review\.json$/),
  ]);
  await ui.unmount();
});

test('a review whose diff leaves its folder is unreadable', async ($, on) => {
  world(on, {
    text: JSON.stringify(REVIEW).replace('diff/home.png', '../diff.png'),
  });
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect(await texts(ui)).toEqual([UNREADABLE]);
  await ui.unmount();
});

test('a review naming another run is unreadable', async ($, on) => {
  world(on, { text: JSON.stringify({ ...REVIEW, id: 'zzz999' }) });
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect(await texts(ui)).toEqual([UNREADABLE]);
  await ui.unmount();
});

test('a review that does not say what a thing captured is unreadable', async ($, on) => {
  world(on, {
    text: JSON.stringify(REVIEW).replace(',"target":"Components/Button"', ''),
  });
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect(await texts(ui)).toEqual([UNREADABLE]);
  expect(await ui.findAll({ type: 'Svg' })).toEqual([]);
  await ui.unmount();
});

test('a review with a height that is not a number is unreadable', async ($, on) => {
  world(on, {
    text: JSON.stringify(REVIEW).replace('"height":160', '"height":"160"'),
  });
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect(await texts(ui)).toEqual([UNREADABLE]);
  expect(await ui.findAll({ type: 'Svg' })).toEqual([]);
  await ui.unmount();
});

test('a review from another version of ui-compare asks for an update', async ($, on) => {
  world(on, { text: JSON.stringify({ ...REVIEW, version: 2 }) });
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect(await texts(ui)).toEqual([
    'Could not read the ui-compare result: a different version of ui-compare wrote it. Update the ui-compare plugin or CLI so they match.',
  ]);
  await ui.unmount();
});

test('the Japanese pane asks for an update without naming the run', async ($, on) => {
  world(on, {
    language: 'ja',
    text: JSON.stringify({ ...REVIEW, version: 2 }),
  });
  await showLatestRun($);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });

  expect(await texts(ui)).toEqual([
    'ui-compare の結果を読み込めませんでした。別のバージョンの ui-compare が書いた結果です。ui-compare のプラグインか CLI を更新してバージョンを揃えてください。',
  ]);
  await ui.unmount();
});
