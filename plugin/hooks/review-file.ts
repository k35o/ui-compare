/**
 * The shape of `.ui-compare/<id>/review.json`, which `ui-compare after` writes
 * for every run and the Claude Code pane reads. Paths are relative to the run
 * directory. The pane cannot decode PNGs, so every picture comes cut into
 * horizontal strips that each fit one Svg element.
 */
export type ReviewFile = {
  version: 1;
  id: string;
  beforeAt: string;
  afterAt: string;
  errors: ReviewError[];
  changed: ReviewScreen[];
  noise: ReviewLine[];
  unchanged: ReviewLine[];
  skipped: ReviewLine[];
};

export type Box = { x: number; y: number; width: number; height: number };

export type ReviewScreenRef = {
  key: string;
  kind: 'url' | 'component';
  label: string;
};

export type ReviewVariant = {
  shotKey: string;
  viewport: { width: number; height: number };
  colorScheme: 'light' | 'dark';
  story?: string;
  warnings: string[];
};

export type ReviewError = {
  screen: ReviewScreenRef;
  variants: ReviewVariant[];
  phase: 'before' | 'after';
  message: string;
};

export type ReviewScreen = {
  screen: ReviewScreenRef;
  changes: ReviewChange[];
};

export type ReviewChange = {
  variants: ReviewVariant[];
  /** Empty when `fullPage` is true: the change is shown as the whole page. */
  crops: ReviewCrop[];
  fullPage: boolean;
  dimensions?: {
    before: [width: number, height: number];
    after: [width: number, height: number];
  };
  /** The full page of the first variant. */
  page: ReviewPage;
  /** The diff image of the first variant. */
  diff: string;
};

/** `area` and `box` are in page coordinates. */
export type ReviewCrop = {
  area: Box;
  box: Box;
  before: StripImage;
  after: StripImage;
};

export type ReviewPage = {
  before?: StripImage;
  after?: StripImage;
  /** Where the two Before loads differed; only on noise lines. */
  unstable?: StripImage;
  /** Changed areas, in page coordinates. */
  marks: Box[];
};

export type ReviewLine = {
  screen: ReviewScreenRef;
  variants: ReviewVariant[];
  reason?: string;
  /** The full page of the first variant, when it was captured. */
  page?: ReviewPage;
};

export type StripImage = { width: number; height: number; strips: Strip[] };

/**
 * One horizontal band of a picture, `y` and `height` in its pixels. Its PNG
 * encodes to at most 100,000 base64 characters, which leaves room for the
 * markup around it under the pane's 131,072-character cap on an Svg's source.
 */
export type Strip = { file: string; y: number; height: number };
