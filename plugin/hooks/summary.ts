import type {
  Box,
  ReviewChange,
  ReviewFile,
  ReviewScreen,
  ReviewScreenRef,
  ReviewVariant,
  StripImage,
} from './review-file';
import type { Strings } from './strings';

export const STORE = '.ui-compare';

export function runPath(id: string, file: string): string {
  return `${STORE}/${id}/${file}`;
}

export function changeKey(screen: number, change: number): string {
  return `change:${screen}:${change}`;
}

export function lineKey(
  kind: 'noise' | 'unchanged' | 'skipped',
  index: number,
): string {
  return `${kind}:${index}`;
}

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

function setting(variant: ReviewVariant, t: Strings): string {
  const { width, height } = variant.viewport;
  return `${width}×${height}${variant.colorScheme === 'dark' ? ` ${t.dark}` : ''}`;
}

export function conditions(
  variants: readonly ReviewVariant[],
  t: Strings,
): string {
  const stories = unique(
    variants.flatMap(({ story }) => (story === undefined ? [] : [story])),
  );
  const settings = unique(variants.map((variant) => setting(variant, t)));
  if (variants.length === Math.max(stories.length, 1) * settings.length) {
    return [t.list(stories), t.list(settings)].filter(Boolean).join(' · ');
  }
  return t.list(
    variants.map((variant) =>
      [variant.story, setting(variant, t)].filter(Boolean).join(' · '),
    ),
  );
}

export type Overview = { headline: string; lead: string | undefined };

export function overview(review: ReviewFile, t: Strings): Overview {
  const screensOf = (entries: ReadonlyArray<{ screen: ReviewScreenRef }>) =>
    unique(entries.map(({ screen }) => screen.key));
  const errorScreens = screensOf(review.errors).length;
  const changedScreens = review.changed.length;
  const counted = new Set(screensOf([...review.changed, ...review.errors]));
  const othersOf = (entries: ReadonlyArray<{ screen: ReviewScreenRef }>) =>
    screensOf(entries).filter((key) => !counted.has(key)).length;
  const noiseScreens = othersOf(review.noise);
  const unchangedScreens = othersOf(review.unchanged);
  const skippedScreens = othersOf(review.skipped);
  const total = counted.size + noiseScreens + unchangedScreens + skippedScreens;
  const headline =
    changedScreens > 0
      ? t.changedHeadline(changedScreens)
      : errorScreens > 0
        ? t.failedHeadline(errorScreens)
        : total === 0
          ? t.emptyHeadline
          : t.unchangedHeadline;
  const counts = [
    changedScreens > 0 && errorScreens > 0 ? t.failedCount(errorScreens) : null,
    noiseScreens > 0 ? t.noiseCount(noiseScreens) : null,
    unchangedScreens > 0 ? t.unchangedCount(unchangedScreens) : null,
    skippedScreens > 0 ? t.skippedCount(skippedScreens) : null,
  ].filter((count) => count !== null);
  return {
    headline,
    lead: counts.length > 0 ? t.lead(t.list(counts)) : undefined,
  };
}

const pad = (value: number) => String(value).padStart(2, '0');

export function formatTime(iso: string, reference?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const other = reference === undefined ? undefined : new Date(reference);
  const sameDay =
    other !== undefined &&
    other.getFullYear() === date.getFullYear() &&
    other.getMonth() === date.getMonth() &&
    other.getDate() === date.getDate();
  return sameDay ? time : `${day} ${time}`;
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
  screen: ReviewScreen,
  change: ReviewChange,
  t: Strings,
): string {
  const areas = changeAreas(change);
  const after = afterImage(change);
  return [
    t.draft.intro(id),
    t.draft.screen(screenLabel(screen.screen, t)),
    t.draft.conditions(conditions(change.variants, t)),
    areas.length > 0
      ? t.draft.areas(areas.map(areaText).join('; '))
      : t.draft.noAreas,
    change.dimensions === undefined
      ? null
      : t.draft.pageSize(
          `${change.dimensions.before.join('×')} → ${change.dimensions.after.join('×')}`,
        ),
    t.draft.diff(runPath(id, change.diff)),
    after === undefined ? null : t.draft.after(runPath(id, after)),
    t.draft.ask,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

export function summaryLines(review: ReviewFile, t: Strings): string[] {
  const { headline, lead } = overview(review, t);
  return [
    t.run(review.id),
    headline,
    ...(lead === undefined ? [] : [lead]),
    ...(review.errors.length > 0 ? ['', t.errorsHeading] : []),
    ...review.errors.map(
      (entry) =>
        `  ${screenLabel(entry.screen, t)} · ${conditions(entry.variants, t)} · ${t.phase[entry.phase]}: ${entry.message}`,
    ),
    ...review.changed.flatMap(({ screen, changes }) => [
      '',
      screenLabel(screen, t),
      ...changes.map((change) => {
        const areas = changeAreas(change);
        const where = change.fullPage
          ? [t.fullPage, ...areas.map(areaText)]
          : areas.map((area, index) =>
              areas.length === 1
                ? areaText(area)
                : `${t.area(index + 1, areas.length)} ${areaText(area)}`,
            );
        return `  ${conditions(change.variants, t)}: ${where.join('; ')}`;
      }),
    ]),
  ];
}
