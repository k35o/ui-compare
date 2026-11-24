import { PNG } from 'pngjs';

import type {
  Box,
  ColorScheme,
  ShotDiff,
  ShotResult,
  Summary,
  Target,
  Unstable,
  Viewport,
} from './types.ts';

export type ShotImages = Map<
  string,
  { before?: Buffer; after?: Buffer; diff?: Buffer; unstable?: Buffer }
>;

export type Screen = {
  key: string;
  kind: 'url' | 'component';
  label: string;
};

export type Variant = {
  shotKey: string;
  viewport: Viewport;
  colorScheme: ColorScheme;
  story?: string;
  warnings: string[];
};

export type Crop = { area: Box; box: Box; before: Buffer; after: Buffer };

export type Change = {
  variants: Variant[];
  crops: Crop[];
  fullPage: boolean;
  dimensions?: {
    before: [width: number, height: number];
    after: [width: number, height: number];
  };
};

export type ChangedScreen = { screen: Screen; changes: Change[] };

export type ErrorEntry = {
  screen: Screen;
  variants: Variant[];
  phase: 'before' | 'after';
  message: string;
};

export type ListEntry = {
  screen: Screen;
  variants: Variant[];
  reason?: string;
};

export type Review = {
  id: string;
  beforeAt: string;
  afterAt: string;
  errors: ErrorEntry[];
  changed: ChangedScreen[];
  noise: ListEntry[];
  unchanged: ListEntry[];
  skipped: ListEntry[];
};

const NOISE_TOLERANCE = 16;
const CROP_MARGIN = 48;
const CROP_MIN_WIDTH = 320;
const CROP_MIN_HEIGHT = 160;
const FULL_PAGE_AREAS = 5;

export function buildReview(summary: Summary, images: ShotImages): Review {
  const errors = new Map<string, ErrorEntry>();
  const changed = new Map<string, ChangedScreen>();
  const noise = new Map<string, ListEntry>();
  const unchanged = new Map<string, ListEntry>();
  const skipped = new Map<string, ListEntry>();

  for (const result of summary.shots) {
    const { key } = result.shot;
    const screen = screenOf(result.shot.target);
    const variant = variantOf(result);
    switch (result.status) {
      case 'error': {
        const { phase, message } = required(
          result.error,
          `Shot ${key} is an error without a message`,
        );
        const errorKey = JSON.stringify([screen.key, phase, message]);
        const entry = errors.get(errorKey);
        if (entry === undefined) {
          errors.set(errorKey, { screen, variants: [variant], phase, message });
        } else {
          entry.variants.push(variant);
        }
        break;
      }
      case 'skipped':
        appendTo(
          skipped,
          screen,
          variant,
          required(
            result.skipReason,
            `Shot ${key} is skipped without a reason`,
          ),
        );
        break;
      case 'unchanged':
        appendTo(unchanged, screen, variant);
        break;
      case 'changed': {
        const diff = required(
          result.diff,
          `Shot ${key} is changed without a diff`,
        );
        const pair = imagePair(key, images);
        if (isNoise(diff.regions, result.unstable)) {
          appendTo(noise, screen, variant);
        } else {
          addChange(changed, screen, changeOf(diff, pair, variant));
        }
        break;
      }
    }
  }

  return {
    id: summary.id,
    beforeAt: summary.beforeAt,
    afterAt: summary.afterAt,
    errors: [...errors.values()],
    changed: [...changed.values()],
    noise: [...noise.values()],
    unchanged: [...unchanged.values()],
    skipped: [...skipped.values()],
  };
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

export function screenOf(target: Target): Screen {
  return target.kind === 'url'
    ? { key: `url:${target.url}`, kind: 'url', label: target.url }
    : {
        key: `component:${target.title}`,
        kind: 'component',
        label: target.title,
      };
}

function variantOf({ shot, warnings }: ShotResult): Variant {
  const { key: shotKey, target, viewport, colorScheme } = shot;
  return target.kind === 'story'
    ? { shotKey, viewport, colorScheme, story: target.name, warnings }
    : { shotKey, viewport, colorScheme, warnings };
}

function appendTo(
  lists: Map<string, ListEntry>,
  screen: Screen,
  variant: Variant,
  reason?: string,
): void {
  const key = JSON.stringify([screen.key, reason ?? null]);
  let entry = lists.get(key);
  if (entry === undefined) {
    entry =
      reason === undefined
        ? { screen, variants: [] }
        : { screen, variants: [], reason };
    lists.set(key, entry);
  }
  entry.variants.push(variant);
}

function imagePair(
  key: string,
  images: ShotImages,
): { before: Buffer; after: Buffer } {
  const { before, after } = images.get(key) ?? {};
  if (before === undefined || after === undefined) {
    throw new Error(`Changed shot ${key} has no Before or After image`);
  }
  return { before, after };
}

function isNoise(regions: Box[], unstable: Unstable | undefined): boolean {
  // A size-only change has no areas, and every() over none would call it noise.
  if (unstable === undefined || regions.length === 0) return false;
  const tolerated = unstable.regions.map((box) => expand(box, NOISE_TOLERANCE));
  return regions.every((region) =>
    tolerated.some((area) => intersects(region, area)),
  );
}

function changeOf(
  { regions, dimensions }: ShotDiff,
  pair: { before: Buffer; after: Buffer },
  variant: Variant,
): Change {
  const before = PNG.sync.read(pair.before);
  const after = PNG.sync.read(pair.after);
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const areas = cropAreas(regions, width, height);
  const fullPage = showsFullPage(regions, areas.length, width, height);
  const crops = fullPage
    ? []
    : areas.map(({ area, box }) => ({
        area,
        box,
        before: crop(before, box),
        after: crop(after, box),
      }));
  const change: Change = { variants: [variant], crops, fullPage };
  if (dimensions !== undefined) change.dimensions = dimensions;
  return change;
}

// Regions are split by a 32 px gap, so the corners of one restyled element can
// be separate regions whose crops would show the same element twice. Regions
// whose crops overlap become one area with one crop.
function cropAreas(
  regions: Box[],
  width: number,
  height: number,
): Array<{ area: Box; box: Box }> {
  const areas = regions.map((region) => ({
    area: region,
    box: cropBox(region, width, height),
  }));
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < areas.length && !merged; i++) {
      for (let j = i + 1; j < areas.length && !merged; j++) {
        const a = areas[i];
        const b = areas[j];
        if (a === undefined || b === undefined || !intersects(a.box, b.box)) {
          continue;
        }
        areas.splice(j, 1);
        areas[i] = { area: union(a.area, b.area), box: union(a.box, b.box) };
        merged = true;
      }
    }
  }
  return areas.toSorted((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function showsFullPage(
  regions: Box[],
  areaCount: number,
  width: number,
  height: number,
): boolean {
  const area = regions.reduce((sum, box) => sum + box.width * box.height, 0);
  return (
    regions.length === 0 ||
    areaCount >= FULL_PAGE_AREAS ||
    area > (width * height) / 2
  );
}

function cropBox(region: Box, width: number, height: number): Box {
  const [x, boxWidth] = cropSpan(
    region.x,
    region.width,
    Math.min(CROP_MIN_WIDTH, width),
    width,
  );
  const [y, boxHeight] = cropSpan(
    region.y,
    region.height,
    Math.min(CROP_MIN_HEIGHT, height),
    height,
  );
  return { x, y, width: boxWidth, height: boxHeight };
}

function cropSpan(
  start: number,
  size: number,
  minimum: number,
  limit: number,
): [start: number, size: number] {
  let spanStart = start - CROP_MARGIN;
  let spanSize = size + 2 * CROP_MARGIN;
  if (spanSize < minimum) {
    spanStart -= Math.floor((minimum - spanSize) / 2);
    spanSize = minimum;
  }
  spanSize = Math.min(spanSize, limit);
  // Shifted back inside the page rather than cut at its edge, so a change next
  // to the edge keeps as much surrounding context as one in the middle.
  return [Math.min(Math.max(spanStart, 0), limit - spanSize), spanSize];
}

function crop(image: PNG, box: Box): Buffer {
  const cropped = new PNG({ width: box.width, height: box.height });
  const width = Math.min(box.x + box.width, image.width) - box.x;
  const height = Math.min(box.y + box.height, image.height) - box.y;
  if (width > 0 && height > 0) {
    PNG.bitblt(image, cropped, box.x, box.y, width, height, 0, 0);
  }
  return PNG.sync.write(cropped);
}

function addChange(
  changed: Map<string, ChangedScreen>,
  screen: Screen,
  change: Change,
): void {
  let entry = changed.get(screen.key);
  if (entry === undefined) {
    entry = { screen, changes: [] };
    changed.set(screen.key, entry);
  }
  const same = change.fullPage
    ? undefined
    : entry.changes.find((other) => sameCrops(other.crops, change.crops));
  if (same === undefined) {
    entry.changes.push(change);
  } else {
    same.variants.push(...change.variants);
  }
}

function sameCrops(crops: Crop[], others: Crop[]): boolean {
  return (
    crops.length === others.length &&
    crops.every(({ before, after }, index) => {
      const other = others[index];
      return (
        other !== undefined &&
        before.equals(other.before) &&
        after.equals(other.after)
      );
    })
  );
}

function expand(box: Box, by: number): Box {
  return {
    x: box.x - by,
    y: box.y - by,
    width: box.width + 2 * by,
    height: box.height + 2 * by,
  };
}

function intersects(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}
