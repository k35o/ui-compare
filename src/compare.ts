import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import type { Box, ShotDiff } from './types.ts';

export type ComparePngsResult = {
  passed: boolean;
  diffPng: Buffer | null;
} & ShotDiff;

type DiffImage = { width: number; height: number; data: Uint8Array };

type Edges = { left: number; top: number; right: number; bottom: number };

const DIFF_COLOR: [number, number, number] = [255, 0, 0];

const CELL_SIZE = 16;

function pad(source: PNG, width: number, height: number): PNG {
  if (source.width === width && source.height === height) return source;
  const padded = new PNG({ width, height });
  PNG.bitblt(source, padded, 0, 0, source.width, source.height, 0, 0);
  return padded;
}

export function comparePngs(
  before: Buffer,
  after: Buffer,
  { threshold = 0.1 }: { threshold?: number } = {},
): ComparePngsResult {
  if (before.equals(after)) {
    return {
      passed: true,
      diffPng: null,
      mismatchedPixels: 0,
      mismatchRatio: 0,
      bbox: null,
      regions: [],
    };
  }

  const beforeImage = PNG.sync.read(before);
  const afterImage = PNG.sync.read(after);
  const sameSize =
    beforeImage.width === afterImage.width &&
    beforeImage.height === afterImage.height;
  const width = Math.max(beforeImage.width, afterImage.width);
  const height = Math.max(beforeImage.height, afterImage.height);
  const diff = new PNG({ width, height });

  const mismatchedPixels = pixelmatch(
    pad(beforeImage, width, height).data,
    pad(afterImage, width, height).data,
    diff.data,
    width,
    height,
    {
      threshold,
      includeAA: false,
      alpha: 0.5,
      diffColor: DIFF_COLOR,
      diffColorAlt: DIFF_COLOR,
    },
  );

  if (sameSize && mismatchedPixels === 0) {
    return {
      passed: true,
      diffPng: null,
      mismatchedPixels: 0,
      mismatchRatio: 0,
      bbox: null,
      regions: [],
    };
  }

  const result: ComparePngsResult = {
    passed: false,
    diffPng: PNG.sync.write(diff),
    mismatchedPixels,
    mismatchRatio: mismatchedPixels / (width * height),
    bbox: mismatchBox(diff),
    regions: mismatchRegions(diff),
  };
  if (!sameSize) {
    result.dimensions = {
      before: [beforeImage.width, beforeImage.height],
      after: [afterImage.width, afterImage.height],
    };
  }
  return result;
}

export function mismatchBox(diff: DiffImage): Box | null {
  const edges = mismatchEdges(diff, {
    left: 0,
    top: 0,
    right: diff.width - 1,
    bottom: diff.height - 1,
  });
  return edges === null ? null : toBox(edges);
}

export function mismatchRegions(diff: DiffImage, gap = 32): Box[] {
  // Every pixel of a cell has to lie within the gap of the others, so that a
  // cell never joins pixels the gap keeps apart.
  const cellSize = Math.min(CELL_SIZE, gap + 1);
  const columns = Math.ceil(diff.width / cellSize);
  const rows = Math.ceil(diff.height / cellSize);
  const cells = new Map<number, Edges>();
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const left = column * cellSize;
      const top = row * cellSize;
      const edges = mismatchEdges(diff, {
        left,
        top,
        right: Math.min(left + cellSize, diff.width) - 1,
        bottom: Math.min(top + cellSize, diff.height) - 1,
      });
      if (edges !== null) cells.set(row * columns + column, edges);
    }
  }

  const reach = Math.ceil(gap / cellSize);
  const groups: Edges[] = [];
  const unvisited = new Map(cells);
  for (const [start, startEdges] of cells) {
    if (!unvisited.delete(start)) continue;
    let group = startEdges;
    const queue = [{ index: start, edges: startEdges }];
    for (const { index, edges } of queue) {
      const row = Math.floor(index / columns);
      const column = index % columns;
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const neighborColumn = column + dx;
          if (neighborColumn < 0 || neighborColumn >= columns) continue;
          const neighbor = (row + dy) * columns + neighborColumn;
          const neighborEdges = unvisited.get(neighbor);
          if (neighborEdges === undefined) continue;
          if (!isClose(edges, neighborEdges, gap)) continue;
          unvisited.delete(neighbor);
          queue.push({ index: neighbor, edges: neighborEdges });
          group = union(group, neighborEdges);
        }
      }
    }
    groups.push(group);
  }

  return mergeClose(groups, gap)
    .map(toBox)
    .toSorted((a, b) => a.y - b.y || a.x - b.x);
}

function mismatchEdges(diff: DiffImage, area: Edges): Edges | null {
  // pixelmatch paints unchanged pixels gray (r = g = b) and ignored anti-aliased
  // pixels in aaColor (yellow), so pure red marks exactly the counted mismatches.
  const [red, green, blue] = DIFF_COLOR;
  const { width, data } = diff;
  let left = area.right + 1;
  let top = area.bottom + 1;
  let right = -1;
  let bottom = -1;
  for (let y = area.top; y <= area.bottom; y++) {
    for (let x = area.left; x <= area.right; x++) {
      const offset = (y * width + x) * 4;
      if (
        data[offset] === red &&
        data[offset + 1] === green &&
        data[offset + 2] === blue &&
        data[offset + 3] === 255
      ) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return right < 0 ? null : { left, top, right, bottom };
}

function mergeClose(groups: Edges[], gap: number): Edges[] {
  let merged: Edges[] = [];
  for (const group of groups) {
    let grown = group;
    let rest = merged;
    let absorbed = true;
    while (absorbed) {
      absorbed = false;
      const kept: Edges[] = [];
      for (const other of rest) {
        if (isClose(grown, other, gap)) {
          grown = union(grown, other);
          absorbed = true;
        } else {
          kept.push(other);
        }
      }
      rest = kept;
    }
    rest.push(grown);
    merged = rest;
  }
  return merged;
}

function isClose(a: Edges, b: Edges, gap: number): boolean {
  const gapX = Math.max(a.left, b.left) - Math.min(a.right, b.right) - 1;
  const gapY = Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom) - 1;
  return gapX < gap && gapY < gap;
}

function union(a: Edges, b: Edges): Edges {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

function toBox({ left, top, right, bottom }: Edges): Box {
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
