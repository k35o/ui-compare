import type {
  Box,
  ReviewChange,
  ReviewFile,
  ReviewLine,
  ReviewScreen,
  ReviewScreenRef,
  ReviewVariant,
  StripImage,
} from './review-file';
import type { Strings, ViewportSize } from './strings';

export const STORE = '.ui-compare';

export function runPath(id: string, file: string): string {
  return `${STORE}/${id}/${file}`;
}

export function changeKey(screen: number, change: number): string {
  return `change:${screen}:${change}`;
}

export type OtherKind = 'noise' | 'unchanged' | 'skipped';

export type Other = { key: string; kind: OtherKind; entry: ReviewLine };

export function others(review: ReviewFile): Other[] {
  return (['noise', 'unchanged', 'skipped'] as const).flatMap((kind) =>
    review[kind].map((entry, index) => ({
      key: `${kind}:${index}`,
      kind,
      entry,
    })),
  );
}

export function otherNote({ kind, entry }: Other, t: Strings): string {
  if (kind === 'noise') return t.noise;
  if (kind === 'unchanged') return t.unchanged;
  return t.skipped(entry.reason);
}

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const isPresent = <T>(value: T | undefined): value is T => value !== undefined;

export function variantsText(
  variants: readonly ReviewVariant[],
  t: Strings,
): string {
  const heights = new Map<number, Set<number>>();
  for (const { viewport } of variants)
    heights.set(
      viewport.width,
      (heights.get(viewport.width) ?? new Set()).add(viewport.height),
    );
  const sizeOf = ({ viewport }: ReviewVariant): ViewportSize =>
    (heights.get(viewport.width)?.size ?? 0) > 1
      ? viewport
      : { width: viewport.width };
  const sizeKey = (variant: ReviewVariant) => {
    const { width, height } = sizeOf(variant);
    return `${width}×${height ?? ''}`;
  };
  const schemeOf = (schemes: readonly ReviewVariant['colorScheme'][]) =>
    schemes.includes('dark')
      ? schemes.includes('light')
        ? t.lightAndDarkMode
        : t.darkMode
      : undefined;

  const stories = unique(variants.map(({ story }) => story).filter(isPresent));
  const sizes = [
    ...new Map(
      variants.map((variant) => [sizeKey(variant), sizeOf(variant)]),
    ).values(),
  ];
  const schemes = unique(variants.map(({ colorScheme }) => colorScheme));
  const combinations = new Set(
    variants.map((variant) =>
      [variant.story, sizeKey(variant), variant.colorScheme].join('\n'),
    ),
  );
  if (
    combinations.size ===
    Math.max(stories.length, 1) * sizes.length * schemes.length
  ) {
    const setting = t.setting(
      [t.sizes(sizes), schemeOf(schemes)].filter(isPresent),
    );
    return stories.length === 0 ? setting : t.stories(stories, setting);
  }
  return t.eachOf(
    variants.map((variant) => {
      const size = t.sizes([sizeOf(variant)]);
      const scheme = schemeOf([variant.colorScheme]);
      if (variant.story !== undefined)
        return t.stories(
          [variant.story],
          t.setting([size, scheme].filter(isPresent)),
        );
      return scheme === undefined ? size : t.withScheme(size, scheme);
    }),
  );
}

export type Note = { text: string; isWarning: boolean };

export function changeNotes(change: ReviewChange, t: Strings): Note[] {
  const warnings = unique(change.variants.flatMap(({ warnings }) => warnings));
  return [
    change.dimensions === undefined
      ? undefined
      : t.pageSize(change.dimensions.before, change.dimensions.after),
    change.variants.length > 1
      ? t.sameChange(change.variants.length)
      : undefined,
  ]
    .filter(isPresent)
    .map((text) => ({ text, isWarning: false }))
    .concat(
      warnings.map((warning) => ({
        text: t.warning(warning),
        isWarning: true,
      })),
    );
}

export type Overview = { headline: string; lead: string | undefined };

export function overview(review: ReviewFile, t: Strings): Overview {
  const counted = new Set<string>();
  const firstIn = (entries: ReadonlyArray<{ screen: ReviewScreenRef }>) => {
    const screens = [
      ...new Map(entries.map(({ screen }) => [screen.key, screen])).values(),
    ].filter(({ key }) => !counted.has(key));
    for (const { key } of screens) counted.add(key);
    return screens;
  };
  const changed = firstIn(review.changed);
  const failed = firstIn(review.errors);
  const noise = firstIn(review.noise).length;
  const unchanged = firstIn(review.unchanged).length;
  const skipped = firstIn(review.skipped).length;
  const labels = (screens: readonly ReviewScreenRef[]) =>
    screens.map(({ label }) => label);
  const isNamed = changed.length + failed.length > 0;
  const headline =
    changed.length > 0
      ? t.changedHeadline(labels(changed))
      : failed.length > 0
        ? t.failedHeadline(labels(failed))
        : noise + unchanged > 0
          ? t.unchangedHeadline
          : t.emptyHeadline;
  const counts = [
    changed.length > 0 && failed.length > 0
      ? t.counts.failed(failed.length)
      : undefined,
    noise > 0 ? t.counts.noise(noise) : undefined,
    unchanged > 0 ? t.counts.unchanged(unchanged) : undefined,
    skipped > 0 ? t.counts.skipped(skipped) : undefined,
  ].filter(isPresent);
  return {
    headline,
    lead: counts.length > 0 ? t.lead(counts, isNamed) : undefined,
  };
}

const isValid = (date: Date) => !Number.isNaN(date.getTime());

export function timesLine(review: ReviewFile, t: Strings): string {
  const before = new Date(review.beforeAt);
  const after = new Date(review.afterAt);
  const isSameDay =
    isValid(before) &&
    isValid(after) &&
    before.toDateString() === after.toDateString();
  const format = (iso: string, date: Date) => {
    if (!isValid(date)) return iso;
    const time = `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
    return isSameDay
      ? time
      : `${t.date(date.getMonth() + 1, date.getDate())} ${time}`;
  };
  return `${t.before} ${format(review.beforeAt, before)} · ${t.after} ${format(review.afterAt, after)}`;
}

export function changeAreas(change: ReviewChange): Box[] {
  return change.fullPage
    ? change.page.marks
    : change.crops.map(({ area }) => area);
}

export function areaText({ x, y, width, height }: Box): string {
  return `x=${x} y=${y} ${width}×${height}`;
}

export function screenLabel(screen: ReviewScreenRef, t: Strings): string {
  return screen.kind === 'component'
    ? `${screen.label} (${t.storybook})`
    : screen.label;
}

export function stripAt(image: StripImage, y: number): string | undefined {
  const strip =
    image.strips.find((one) => y >= one.y && y < one.y + one.height) ??
    image.strips[0];
  return strip?.file;
}

function afterImage(change: ReviewChange): string | undefined {
  const [crop] = change.crops;
  if (crop !== undefined) return crop.after.strips[0]?.file;
  const { after } = change.page;
  if (after === undefined) return undefined;
  return stripAt(after, change.page.marks[0]?.y ?? 0);
}

export function draftText(
  id: string,
  { screen }: ReviewScreen,
  change: ReviewChange,
  t: Strings,
): string {
  const areas = changeAreas(change);
  const after = afterImage(change);
  return [
    t.draft.intro(id),
    t.draft.changed(t.named(screen.label, screen.target, screen.kind)),
    t.draft.seenAt(variantsText(change.variants, t)),
    areas.length > 0
      ? t.draft.areas(areas.map(areaText).join('; '))
      : t.draft.noAreas,
    change.dimensions === undefined
      ? undefined
      : t.pageSize(change.dimensions.before, change.dimensions.after),
    t.draft.diff(runPath(id, change.diff)),
    after === undefined ? undefined : t.draft.after(runPath(id, after)),
    t.draft.ask,
  ]
    .filter(isPresent)
    .join('\n');
}

export function summaryLines(review: ReviewFile, t: Strings): string[] {
  const { headline, lead } = overview(review, t);
  const lines = others(review);
  const entryLine = (screen: ReviewScreenRef, variants: ReviewVariant[]) =>
    `  ${screen.label} · ${variantsText(variants, t)}`;
  return [
    timesLine(review, t),
    headline,
    ...(lead === undefined ? [] : [lead]),
    ...(review.errors.length > 0 ? ['', t.errorsHeading] : []),
    ...review.errors.flatMap((entry) => [
      entryLine(entry.screen, entry.variants),
      `    ${t.failure(t.phase[entry.phase], entry.message)}`,
    ]),
    ...review.changed.flatMap(({ screen, changes }) => [
      '',
      screenLabel(screen, t),
      ...changes.flatMap((change) => [
        `  ${variantsText(change.variants, t)}`,
        ...changeNotes(change, t).map(({ text }) => `    ${text}`),
      ]),
    ]),
    ...(lines.length > 0 ? ['', t.othersHeading] : []),
    ...lines.flatMap((line) => [
      entryLine(line.entry.screen, line.entry.variants),
      `    ${otherNote(line, t)}`,
    ]),
  ];
}
