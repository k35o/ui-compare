import { expect, test } from 'claude-code/testing';

import type {
  ReviewChange,
  ReviewFile,
  ReviewScreenRef,
  ReviewVariant,
} from '../hooks/review-file';
import { STRINGS } from '../hooks/strings';
import {
  changeNotes,
  draftText,
  overview,
  timesLine,
  variantsText,
} from '../hooks/summary';
import { localTime, REVIEW } from './fixture';

const { en, ja } = STRINGS;

const NAMES = ['Pricing page', 'Settings page', 'Button', 'Header', 'Footer'];
const NAMES_JA = ['料金ページ', '設定ページ', 'ボタン', 'ヘッダー', 'フッター'];

const thing = (label: string): ReviewScreenRef => ({
  key: `url:${label}`,
  kind: 'url',
  label,
  target: `http://localhost:5173/${label}`,
});

const variant = (
  width: number,
  options: Partial<Omit<ReviewVariant, 'viewport'>> & { height?: number } = {},
): ReviewVariant => {
  const { height = 720, ...rest } = options;
  return {
    shotKey: `${width}`,
    viewport: { width, height },
    colorScheme: 'light',
    warnings: [],
    ...rest,
  };
};

const NOTHING: ReviewFile = {
  ...REVIEW,
  errors: [],
  changed: [],
  noise: [],
  unchanged: [],
  skipped: [],
};

const changedOf = (labels: readonly string[]): ReviewFile => ({
  ...NOTHING,
  changed: labels.map((label) => ({ screen: thing(label), changes: [] })),
});

const failedOf = (labels: readonly string[]): ReviewFile => ({
  ...NOTHING,
  errors: labels.map((label) => ({
    screen: thing(label),
    variants: [variant(1280)],
    phase: 'before',
    message: 'Timeout',
  })),
});

const linesOf = (labels: readonly string[]) =>
  labels.map((label) => ({ screen: thing(label), variants: [variant(1280)] }));

test('the headline names up to three changed things', () => {
  expect(
    [1, 2, 3].map(
      (count) => overview(changedOf(NAMES.slice(0, count)), en).headline,
    ),
  ).toEqual([
    'Pricing page changed',
    'Pricing page and Settings page changed',
    'Pricing page, Settings page and Button changed',
  ]);
});

test('the headline names the first three changed things and counts the rest', () => {
  expect(overview(changedOf(NAMES), en).headline).toBe(
    'Pricing page, Settings page, Button and 2 more changed',
  );
});

test('the Japanese headline quotes up to three changed names', () => {
  expect(
    [1, 2, 3].map(
      (count) => overview(changedOf(NAMES_JA.slice(0, count)), ja).headline,
    ),
  ).toEqual([
    '「料金ページ」の見た目が変わりました',
    '「料金ページ」と「設定ページ」の見た目が変わりました',
    '「料金ページ」「設定ページ」「ボタン」の見た目が変わりました',
  ]);
});

test('the Japanese headline quotes the first three changed names and counts the rest', () => {
  expect(overview(changedOf(NAMES_JA), ja).headline).toBe(
    '「料金ページ」「設定ページ」「ボタン」ほか 2 件の見た目が変わりました',
  );
});

test('with nothing changed, the headline names what could not be captured', () => {
  expect(
    [1, 2, 5].map(
      (count) => overview(failedOf(NAMES.slice(0, count)), en).headline,
    ),
  ).toEqual([
    'Pricing page could not be captured',
    'Pricing page and Settings page could not be captured',
    'Pricing page, Settings page, Button and 2 more could not be captured',
  ]);
  expect(
    [1, 2, 3, 5].map(
      (count) => overview(failedOf(NAMES_JA.slice(0, count)), ja).headline,
    ),
  ).toEqual([
    '「料金ページ」を撮影できませんでした',
    '「料金ページ」と「設定ページ」を撮影できませんでした',
    '「料金ページ」「設定ページ」「ボタン」を撮影できませんでした',
    '「料金ページ」「設定ページ」「ボタン」ほか 2 件を撮影できませんでした',
  ]);
});

test('a headline about what could not be captured leaves it out of the sentence under it', () => {
  const review = {
    ...failedOf(['Pricing page']),
    unchanged: linesOf(['Button']),
  };

  expect(overview(review, en)).toEqual({
    headline: 'Pricing page could not be captured',
    lead: 'Also 1 unchanged.',
  });
  expect(overview(review, ja)).toEqual({
    headline: '「Pricing page」を撮影できませんでした',
    lead: 'ほかに、変わらなかったもの 1 件があります',
  });
});

test('with nothing changed or failed, the headline says nothing looks different and the counts follow without Also', () => {
  const review = {
    ...NOTHING,
    unchanged: linesOf(['A', 'B', 'C']),
    skipped: linesOf(['D']),
  };

  expect(overview(review, en)).toEqual({
    headline: 'Nothing looks different',
    lead: '3 unchanged and 1 left out.',
  });
  expect(overview(review, ja)).toEqual({
    headline: '見た目は変わっていません',
    lead: '変わらなかったもの 3 件、撮影しなかったもの 1 件があります',
  });
});

test('with only things that change on every load, nothing looks different', () => {
  const review = { ...NOTHING, noise: linesOf(['Clock']) };

  expect(overview(review, en)).toEqual({
    headline: 'Nothing looks different',
    lead: '1 changed only where it changes on every load.',
  });
});

test('with nothing captured, the headline says so and nothing is under it', () => {
  expect(overview(NOTHING, en)).toEqual({
    headline: 'Nothing was captured',
    lead: undefined,
  });
  expect(overview(NOTHING, ja)).toEqual({
    headline: '撮影したものはありません',
    lead: undefined,
  });
});

test('with only things left out, the headline says nothing was captured', () => {
  const review = { ...NOTHING, skipped: linesOf(['A', 'B']) };

  expect(overview(review, en)).toEqual({
    headline: 'Nothing was captured',
    lead: '2 left out.',
  });
  expect(overview(review, ja)).toEqual({
    headline: '撮影したものはありません',
    lead: '撮影しなかったもの 2 件があります',
  });
});

test('a thing that changed is not counted again as not captured', () => {
  const review = {
    ...changedOf(['Pricing page']),
    errors: failedOf(['Pricing page', 'Button']).errors,
  };

  expect(overview(review, en)).toEqual({
    headline: 'Pricing page changed',
    lead: 'Also 1 not captured.',
  });
  expect(overview(review, ja).lead).toBe(
    'ほかに、撮影できなかったもの 1 件があります',
  );
});

test('a thing is counted once, in the first group it is in', () => {
  const review = {
    ...NOTHING,
    noise: linesOf(['A']),
    unchanged: linesOf(['A', 'B']),
    skipped: linesOf(['B', 'C']),
  };

  expect(overview(review, en).lead).toBe(
    '1 changed only where it changes on every load, 1 unchanged and 1 left out.',
  );
});

test('a component with one story unchanged and one left out counts once, as unchanged', () => {
  const button: ReviewScreenRef = {
    key: 'component:Components/Button',
    kind: 'component',
    label: 'Button',
    target: 'Components/Button',
  };
  const review = {
    ...NOTHING,
    unchanged: [
      { screen: button, variants: [variant(1280, { story: 'Primary' })] },
    ],
    skipped: [
      {
        screen: button,
        variants: [variant(1280, { story: 'Loading' })],
        reason: 'The story failed to render',
      },
    ],
  };

  expect(overview(review, en)).toEqual({
    headline: 'Nothing looks different',
    lead: '1 unchanged.',
  });
  expect(overview(review, ja)).toEqual({
    headline: '見た目は変わっていません',
    lead: '変わらなかったもの 1 件があります',
  });
});

test('English says it for one thing that changed only where it changes on every load, they for more', () => {
  const leadWith = (labels: readonly string[]) =>
    overview({ ...changedOf(['Home']), noise: linesOf(labels) }, en).lead;

  expect(leadWith(['A'])).toBe(
    'Also 1 changed only where it changes on every load.',
  );
  expect(leadWith(['A', 'B'])).toBe(
    'Also 2 changed only where they change on every load.',
  );
});

test('the sentence under the headline lists only the counts that are not zero', () => {
  const review = {
    ...changedOf(['Pricing page']),
    unchanged: linesOf(['A', 'B', 'C']),
    skipped: linesOf(['D']),
  };

  expect(overview(review, en).lead).toBe('Also 3 unchanged and 1 left out.');
  expect(overview(review, ja).lead).toBe(
    'ほかに、変わらなかったもの 3 件、撮影しなかったもの 1 件があります',
  );
});

test('variants that differ only in width are described by their widths', () => {
  const two = [variant(1280), variant(375)];
  const three = [variant(1280), variant(768), variant(375)];

  expect(variantsText(two, en)).toBe('1280px and 375px wide');
  expect(variantsText(two, ja)).toBe('幅 1280px と 375px');
  expect(variantsText(three, en)).toBe('1280px, 768px and 375px wide');
  expect(variantsText(three, ja)).toBe('幅 1280px、768px、375px');
});

test('heights are given only for variants that share a width', () => {
  const variants = [
    variant(1280, { height: 720 }),
    variant(1280, { height: 900 }),
    variant(375, { height: 812 }),
  ];

  expect(variantsText(variants, en)).toBe('1280×720, 1280×900 and 375px wide');
  expect(variantsText(variants, ja)).toBe('1280×720、1280×900、幅 375px');
});

test('the dark color scheme is added after the widths', () => {
  const variants = [variant(1280, { colorScheme: 'dark' })];

  expect(variantsText(variants, en)).toBe('1280px wide, dark mode');
  expect(variantsText(variants, ja)).toBe('幅 1280px、ダークモード');
});

test('stories come first, with the widths and color scheme in brackets', () => {
  const one = [variant(1280, { story: 'Primary', colorScheme: 'dark' })];
  const grid = ['Primary', 'Secondary'].flatMap((story) =>
    [1280, 375].map((width) => variant(width, { story })),
  );

  expect(variantsText(one, en)).toBe('Primary (1280px wide, dark mode)');
  expect(variantsText(one, ja)).toBe('Primary（幅 1280px、ダークモード）');
  expect(variantsText(grid, en)).toBe(
    'Primary and Secondary (1280px and 375px wide)',
  );
  expect(variantsText(grid, ja)).toBe(
    'Primary と Secondary（幅 1280px と 375px）',
  );
});

test('variants that do not cover every combination are listed one by one', () => {
  const stories = [
    variant(1280, { story: 'Primary' }),
    variant(375, { story: 'Secondary' }),
  ];
  const settings = [
    variant(1280),
    variant(1280, { colorScheme: 'dark' }),
    variant(375),
  ];

  expect(variantsText(stories, en)).toBe(
    'Primary (1280px wide) and Secondary (375px wide)',
  );
  expect(variantsText(stories, ja)).toBe(
    'Primary（幅 1280px）、Secondary（幅 375px）',
  );
  expect(variantsText(settings, en)).toBe(
    '1280px wide, 1280px wide (dark mode) and 375px wide',
  );
  expect(variantsText(settings, ja)).toBe(
    '幅 1280px、幅 1280px（ダークモード）、幅 375px',
  );
});

const changeSeenAt = (widths: readonly number[]): ReviewChange => ({
  variants: widths.map((width) => variant(width)),
  crops: [],
  fullPage: true,
  page: { marks: [] },
  diff: 'diff/home.png',
});

const notesOf = (change: ReviewChange, t: typeof en) =>
  changeNotes(change, t).map(({ text }) => text);

test('a change seen in one variant has no note about the others', () => {
  expect(notesOf(changeSeenAt([1280]), en)).toEqual([]);
});

test('a change seen in two variants says both changed the same way', () => {
  const change = changeSeenAt([1280, 375]);

  expect(notesOf(change, en)).toEqual(['Both changed the same way.']);
  expect(notesOf(change, ja)).toEqual(['どちらも同じ変わり方です']);
});

test('a change seen in three or more variants says they all changed the same way', () => {
  const change = changeSeenAt([1280, 768, 375]);

  expect(notesOf(change, en)).toEqual(['They all changed the same way.']);
  expect(notesOf(change, ja)).toEqual(['どれも同じ変わり方です']);
});

const capturedAt = (beforeAt: string, afterAt: string): ReviewFile => ({
  ...NOTHING,
  beforeAt,
  afterAt,
});

test('capture times on the same day are given as 24-hour times', () => {
  const review = capturedAt(localTime(11, 24, 9, 5), localTime(11, 24, 21, 30));

  expect(timesLine(review, en)).toBe('Before 9:05 · After 21:30');
  expect(timesLine(review, ja)).toBe('変更前 9:05 · 変更後 21:30');
});

test('capture times on different days both carry their dates', () => {
  const review = capturedAt(
    localTime(11, 23, 10, 2),
    localTime(11, 24, 10, 15),
  );

  expect(timesLine(review, en)).toBe(
    'Before Nov 23 10:02 · After Nov 24 10:15',
  );
  expect(timesLine(review, ja)).toBe(
    '変更前 11月23日 10:02 · 変更後 11月24日 10:15',
  );
});

test('a capture time that cannot be read is shown as given', () => {
  const review = capturedAt('yesterday', localTime(1, 5, 10, 15));

  expect(timesLine(review, en)).toBe('Before yesterday · After Jan 5 10:15');
  expect(timesLine(review, ja)).toBe('変更前 yesterday · 変更後 1月5日 10:15');
});

test('a page that only grew taller says how its height changed', () => {
  expect(en.pageSize([1280, 720], [1280, 1100])).toBe(
    'The page height changed from 720px to 1100px.',
  );
  expect(ja.pageSize([1280, 720], [1280, 1100])).toBe(
    'ページの高さが 720px から 1100px に変わりました',
  );
});

test('a page whose width changed says how its size changed', () => {
  expect(en.pageSize([1280, 720], [1000, 1000])).toBe(
    'The page size changed from 1280×720 to 1000×1000.',
  );
  expect(ja.pageSize([1280, 720], [1000, 1000])).toBe(
    'ページの大きさが 1280×720 から 1000×1000 に変わりました',
  );
});

test('the draft for a Storybook component names it and its title', () => {
  const button = REVIEW.changed[1];
  const change = button?.changes[0];
  if (button === undefined || change === undefined)
    throw new Error('the fixture has no Button change');

  expect(draftText(REVIEW.id, button, change, en).split('\n')[1]).toBe(
    'What changed: Button (Storybook component Components/Button)',
  );
  expect(draftText(REVIEW.id, button, change, ja).split('\n')[1]).toBe(
    '変わったもの：「Button」（Storybook のコンポーネント Components/Button）',
  );
});
