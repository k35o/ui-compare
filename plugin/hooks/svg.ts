import type { Box, StripImage } from './review-file';

export const SVG_SOURCE_LIMIT = 131_072;

const MARK_COLOR = '#e5484d';
const FILLER_COLOR = '#8b8d98';
// report.html draws a 2px outline 3px outside the area; a centered 2px stroke
// lands there 4px out. The padding keeps it visible at the picture's edges.
const OUTLINE_OFFSET = 4;
const PADDING = 6;

export type Size = { width: number; height: number };

export type StripDrawing =
  | { file: string; source: string }
  | { file: string; problem: 'unreadable' | 'too-large' };

export function frameOf(
  ...images: ReadonlyArray<StripImage | undefined>
): Size {
  const shown = images.filter((image) => image !== undefined);
  return {
    width: Math.max(0, ...shown.map(({ width }) => width)),
    height: Math.max(0, ...shown.map(({ height }) => height)),
  };
}

export function stripDrawings(
  image: StripImage,
  frame: Size,
  marks: readonly Box[],
  base64Of: (file: string) => string | undefined,
): StripDrawing[] {
  const last = image.strips.length - 1;
  return image.strips.map((strip, index) => {
    const { file } = strip;
    const base64 = base64Of(file);
    if (base64 === undefined) return { file, problem: 'unreadable' };
    const rows =
      index === last
        ? Math.max(strip.height, frame.height - strip.y)
        : strip.height;
    const top = index === 0 ? -PADDING : 0;
    const bottom = rows + (index === last ? PADDING : 0);
    const width = frame.width + 2 * PADDING;
    const height = bottom - top;
    const picture =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${-PADDING} ${top} ${width} ${height}">` +
      `<rect width="${frame.width}" height="${rows}" fill="${FILLER_COLOR}"/>` +
      `<image width="${image.width}" height="${strip.height}" href="data:image/png;base64,${base64}"/>`;
    const outlines = marks
      .map((mark) => outline(mark, strip.y))
      .filter(
        (rect) => rect.y + rect.height + 1 >= top && rect.y - 1 <= bottom,
      );
    const sourceWith = (rects: readonly Box[]) =>
      `${picture}${rects.map(outlineMarkup).join('')}</svg>`;
    const full = sourceWith(outlines);
    const source =
      full.length <= SVG_SOURCE_LIMIT || outlines.length <= 1
        ? full
        : sourceWith([around(outlines)]);
    return source.length > SVG_SOURCE_LIMIT
      ? { file, problem: 'too-large' }
      : { file, source };
  });
}

function outline(mark: Box, stripY: number): Box {
  return {
    x: mark.x - OUTLINE_OFFSET,
    y: mark.y - stripY - OUTLINE_OFFSET,
    width: Math.max(mark.width, 2) + 2 * OUTLINE_OFFSET,
    height: Math.max(mark.height, 2) + 2 * OUTLINE_OFFSET,
  };
}

function around(rects: readonly Box[]): Box {
  const edges = rects.reduce(
    (edge, { x, y, width, height }) => ({
      left: Math.min(edge.left, x),
      top: Math.min(edge.top, y),
      right: Math.max(edge.right, x + width),
      bottom: Math.max(edge.bottom, y + height),
    }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
  );
  return {
    x: edges.left,
    y: edges.top,
    width: edges.right - edges.left,
    height: edges.bottom - edges.top,
  };
}

function outlineMarkup({ x, y, width, height }: Box): string {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="2" fill="none" stroke="${MARK_COLOR}" stroke-width="2"/>`;
}
