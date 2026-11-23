export type ColorScheme = 'light' | 'dark';

export type Viewport = { width: number; height: number };

export type Box = { x: number; y: number; width: number; height: number };

export type UrlTarget = { kind: 'url'; url: string };

export type StoryTarget = {
  kind: 'story';
  url: string;
  storyId: string;
  title: string;
  name: string;
  importPath: string;
};

export type Target = UrlTarget | StoryTarget;

export type Shot = {
  key: string;
  target: Target;
  viewport: Viewport;
  colorScheme: ColorScheme;
};

export type CaptureOutcome =
  | { status: 'captured'; png: Buffer; warnings: string[] }
  | { status: 'skipped'; reason: string }
  | { status: 'error'; message: string };

export type Unstable = { mismatchRatio: number; bbox: Box | null };

export type BeforeShot =
  | { key: string; status: 'captured'; warnings: string[]; unstable?: Unstable }
  | { key: string; status: 'skipped'; reason: string }
  | { key: string; status: 'error'; message: string };

export type RunFile = {
  version: 1;
  id: string;
  createdAt: string;
  masks: string[];
  shots: Shot[];
  before: BeforeShot[];
};

export type ShotStatus = 'changed' | 'unchanged' | 'error' | 'skipped';

export type ShotDiff = {
  mismatchedPixels: number;
  mismatchRatio: number;
  bbox: Box | null;
  dimensions?: {
    before: [width: number, height: number];
    after: [width: number, height: number];
  };
};

export type ShotResult = {
  shot: Shot;
  status: ShotStatus;
  diff?: ShotDiff;
  error?: { phase: 'before' | 'after'; message: string };
  skipReason?: string;
  unstable?: Unstable;
  warnings: string[];
  files: { before?: string; after?: string; diff?: string; unstable?: string };
};

export type Summary = {
  version: 1;
  id: string;
  beforeAt: string;
  afterAt: string;
  counts: Record<ShotStatus, number>;
  shots: ShotResult[];
};
