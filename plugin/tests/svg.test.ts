import { expect, test } from 'claude-code/testing';

import type { Box } from '../hooks/review-file';
import { stripDrawings, SVG_SOURCE_LIMIT } from '../hooks/svg';
import { image, PIXEL } from './fixture';

const page = image('page', 100, [600, 400]);
const frame = { width: 100, height: 1000 };

const outlinesOf = (source: string) =>
  source.match(/<rect x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*"/g) ?? [];

const sourcesOf = (
  marks: readonly Box[],
  base64Of: (file: string) => string = () => PIXEL,
) =>
  stripDrawings(page, frame, marks, base64Of).map((drawing) =>
    'source' in drawing ? drawing.source : drawing.problem,
  );

test('a mark across a strip boundary is outlined in both strips, each from its own top', () => {
  const [top, bottom] = sourcesOf([{ x: 10, y: 580, width: 20, height: 40 }]);

  expect(outlinesOf(String(top))).toEqual([
    '<rect x="6" y="576" width="28" height="48"',
  ]);
  expect(outlinesOf(String(bottom))).toEqual([
    '<rect x="6" y="-24" width="28" height="48"',
  ]);
});

test('marks too many for one Svg are outlined by one rect around them all', () => {
  const marks = Array.from({ length: 2_000 }, (_, index) => ({
    x: 10 + (index % 80),
    y: 20 + Math.floor(index / 80),
    width: 2,
    height: 2,
  }));

  const [top] = sourcesOf(marks);

  expect(String(top).length).toBeLessThanOrEqual(SVG_SOURCE_LIMIT);
  expect(outlinesOf(String(top))).toEqual([
    '<rect x="6" y="16" width="89" height="34"',
  ]);
});

test('a strip that fits only without its outlines is named in text', () => {
  const marks = [
    { x: 10, y: 20, width: 2, height: 2 },
    { x: 50, y: 60, width: 2, height: 2 },
  ];
  const base64 = 'A'.repeat(SVG_SOURCE_LIMIT - 250);

  expect(sourcesOf([], () => base64)[0]).not.toBe('too-large');
  expect(sourcesOf(marks, () => base64)[0]).toBe('too-large');
});
