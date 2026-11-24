import type {
  ReviewFile,
  ReviewScreenRef,
  ReviewVariant,
  StripImage,
} from '../hooks/review-file';

export const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

export const RUN = 'abc123';

export const localTime = (
  month: number,
  day: number,
  hour: number,
  minute: number,
): string => new Date(2026, month - 1, day, hour, minute).toISOString();

export const PANE = {
  plugin: 'ui-compare',
  component: 'Pane',
  requestId: 'ui-compare',
  props: {
    title: 'ui-compare',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const;

export const image = (
  name: string,
  width: number,
  heights: number[],
): StripImage => {
  let y = 0;
  const strips = heights.map((height, index) => {
    const strip = { file: `review/${name}-${index}.png`, y, height };
    y += height;
    return strip;
  });
  return { width, height: y, strips };
};

const url = (label: string, path: string): ReviewScreenRef => ({
  key: `url:http://localhost:5173${path}`,
  kind: 'url',
  label,
  target: `http://localhost:5173${path}`,
});

const light: ReviewVariant = {
  shotKey: 'home',
  viewport: { width: 1280, height: 720 },
  colorScheme: 'light',
  warnings: [],
};

export const REVIEW: ReviewFile = {
  version: 1,
  id: RUN,
  beforeAt: localTime(11, 24, 10, 2),
  afterAt: localTime(11, 24, 10, 15),
  errors: [
    {
      screen: url('Checkout', '/checkout'),
      variants: [{ ...light, shotKey: 'checkout' }],
      phase: 'after',
      message: 'net::ERR_CONNECTION_REFUSED',
    },
  ],
  changed: [
    {
      screen: url('Home', '/'),
      changes: [
        {
          variants: [light],
          crops: [
            {
              area: { x: 100, y: 200, width: 120, height: 40 },
              box: { x: 52, y: 140, width: 320, height: 160 },
              before: image('home-crop-before', 320, [160]),
              after: image('home-crop-after', 320, [160]),
            },
          ],
          fullPage: false,
          page: {
            before: image('home-before', 1280, [720]),
            after: image('home-after', 1280, [600, 400]),
            marks: [{ x: 100, y: 200, width: 120, height: 40 }],
          },
          diff: 'diff/home.png',
        },
      ],
    },
    {
      screen: {
        key: 'component:Components/Button',
        kind: 'component',
        label: 'Button',
        target: 'Components/Button',
      },
      changes: [
        {
          variants: [
            {
              ...light,
              shotKey: 'button-light',
              story: 'Primary',
              warnings: ['Fonts were still loading'],
            },
            {
              ...light,
              shotKey: 'button-dark',
              story: 'Primary',
              colorScheme: 'dark',
            },
          ],
          crops: [
            {
              area: { x: 10, y: 10, width: 30, height: 20 },
              box: { x: 0, y: 0, width: 320, height: 160 },
              before: image('button-crop-0-before', 320, [160]),
              after: image('button-crop-0-after', 320, [160]),
            },
            {
              area: { x: 600, y: 400, width: 50, height: 20 },
              box: { x: 480, y: 340, width: 320, height: 160 },
              before: image('button-crop-1-before', 320, [160]),
              after: image('button-crop-1-after', 320, [160]),
            },
          ],
          fullPage: false,
          page: {
            before: image('button-before', 1280, [720]),
            after: image('button-after', 1280, [720]),
            marks: [],
          },
          diff: 'diff/button-light.png',
        },
      ],
    },
    {
      screen: url('Pricing page', '/pricing'),
      changes: [
        {
          variants: [{ ...light, shotKey: 'pricing' }],
          crops: [],
          fullPage: true,
          dimensions: { before: [1280, 720], after: [1280, 1100] },
          page: {
            before: image('pricing-before', 1280, [720]),
            after: image('pricing-after', 1280, [600, 500]),
            marks: [{ x: 0, y: 700, width: 1280, height: 400 }],
          },
          diff: 'diff/pricing.png',
        },
      ],
    },
  ],
  noise: [
    {
      screen: url('Clock', '/clock'),
      variants: [{ ...light, shotKey: 'clock' }],
      page: {
        before: image('clock-before', 1280, [720]),
        after: image('clock-after', 1280, [720]),
        unstable: image('clock-unstable', 1280, [720]),
        marks: [],
      },
    },
  ],
  unchanged: [
    {
      screen: url('About', '/about'),
      variants: [{ ...light, shotKey: 'about' }],
      page: {
        before: image('about-before', 1280, [720]),
        after: image('about-after', 1280, [720]),
        marks: [],
      },
    },
  ],
  skipped: [
    {
      screen: url('Admin', '/admin'),
      variants: [{ ...light, shotKey: 'admin' }],
      reason: 'Redirected to a login page',
    },
  ],
};
