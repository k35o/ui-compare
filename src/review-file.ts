import { PNG } from 'pngjs';

import type {
  ReviewChange,
  ReviewFile,
  ReviewLine,
  ReviewPage,
  Strip,
  StripImage,
} from '../plugin/hooks/review-file.ts';
import type {
  Change,
  ListEntry,
  Review,
  ShotImages,
  Variant,
} from './review.ts';
import { REVIEW_DIR, writeImage, writeReviewJson } from './store.ts';
import type { Box, Summary } from './types.ts';

type PageKind = 'before' | 'after' | 'unstable';

type Band = { y: number; height: number; png: Buffer };

const MAX_STRIP_HEIGHT = 1024;
const MAX_STRIP_BASE64_LENGTH = 100_000;

export async function writeReviewFile(
  dir: string,
  review: Review,
  images: ShotImages,
  summary: Summary,
): Promise<void> {
  const diffs = new Map(
    summary.shots.map(({ shot, files }) => [shot.key, files.diff]),
  );

  const picture = async (
    shotKey: string,
    name: string,
    png: Buffer,
  ): Promise<StripImage> => {
    const strips: Strip[] = [];
    for (const band of cut(png, shotKey, name)) {
      const file = `${REVIEW_DIR}/${shotKey}-${name}-${strips.length}.png`;
      await writeImage(dir, file, band.png);
      strips.push({ file, y: band.y, height: band.height });
    }
    return {
      width: png.readUInt32BE(16),
      height: png.readUInt32BE(20),
      strips,
    };
  };

  const page = async (
    shotKey: string,
    kinds: PageKind[],
    marks: Box[],
  ): Promise<ReviewPage> => {
    const set = images.get(shotKey);
    const pictures: Partial<Record<PageKind, StripImage>> = {};
    for (const kind of kinds) {
      const png = set?.[kind];
      if (png === undefined) continue;
      const { before } = pictures;
      pictures[kind] =
        kind === 'after' &&
        before !== undefined &&
        set?.before?.equals(png) === true
          ? before
          : await picture(shotKey, `page-${kind}`, png);
    }
    return { ...pictures, marks };
  };

  const change = async ({
    variants,
    crops,
    fullPage,
    marks,
    dimensions,
  }: Change): Promise<ReviewChange> => {
    const shotKey = firstShotKey(variants);
    const diff = diffs.get(shotKey);
    if (diff === undefined) {
      throw new Error(`Changed shot ${shotKey} has no diff image`);
    }
    return {
      variants,
      crops: await inOrder(
        crops,
        async ({ area, box, before, after }, index) => ({
          area,
          box,
          before: await picture(shotKey, `crop-${index}-before`, before),
          after: await picture(shotKey, `crop-${index}-after`, after),
        }),
      ),
      fullPage,
      ...(dimensions === undefined ? {} : { dimensions }),
      page: await page(shotKey, ['before', 'after'], marks),
      diff,
    };
  };

  const lines = (
    entries: ListEntry[],
    kinds: PageKind[],
  ): Promise<ReviewLine[]> =>
    inOrder(entries, async (entry) => {
      const shown = await page(firstShotKey(entry.variants), kinds, []);
      return kinds.some((kind) => shown[kind] !== undefined)
        ? { ...entry, page: shown }
        : entry;
    });

  await writeReviewJson(dir, {
    version: 1,
    id: review.id,
    beforeAt: review.beforeAt,
    afterAt: review.afterAt,
    errors: review.errors,
    changed: await inOrder(review.changed, async ({ screen, changes }) => ({
      screen,
      changes: await inOrder(changes, change),
    })),
    noise: await lines(review.noise, ['before', 'after', 'unstable']),
    unchanged: await lines(review.unchanged, ['before', 'after']),
    skipped: await lines(review.skipped, ['before', 'after']),
  } satisfies ReviewFile);
}

// One item at a time rather than Promise.all, so that only one decoded
// picture and one encoded strip are held in memory at once.
async function inOrder<T, R>(
  items: T[],
  map: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (const [index, item] of items.entries()) {
    results.push(await map(item, index));
  }
  return results;
}

function firstShotKey([first]: Variant[]): string {
  if (first === undefined) throw new Error('A review entry has no variants');
  return first.shotKey;
}

function* cut(png: Buffer, shotKey: string, name: string): Generator<Band> {
  if (fits(png)) {
    yield { y: 0, height: png.readUInt32BE(20), png };
    return;
  }
  const image = PNG.sync.read(png);
  let bandHeight = MAX_STRIP_HEIGHT;
  for (let y = 0; y < image.height;) {
    const height = Math.min(bandHeight, image.height - y);
    const band = encodeBand(image, y, height);
    if (fits(band)) {
      yield { y, height, png: band };
      y += height;
      bandHeight = Math.min(height * 2, MAX_STRIP_HEIGHT);
    } else if (height === 1) {
      throw new Error(
        `Cannot cut the ${name} picture of shot ${shotKey} into strips: one row of its pixels encodes to more than ${MAX_STRIP_BASE64_LENGTH} base64 characters`,
      );
    } else {
      bandHeight = Math.ceil(height / 2);
    }
  }
}

function encodeBand(image: PNG, y: number, height: number): Buffer {
  const band = new PNG({ width: image.width, height });
  PNG.bitblt(image, band, 0, y, image.width, height, 0, 0);
  return PNG.sync.write(band);
}

function fits(png: Buffer): boolean {
  return Math.ceil(png.length / 3) * 4 <= MAX_STRIP_BASE64_LENGTH;
}
