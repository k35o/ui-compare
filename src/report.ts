import { createHash } from 'node:crypto';

import type { Review, ShotImages, Variant } from './review.ts';

type ImageKind = 'before' | 'after' | 'diff' | 'unstable';

type EmbeddedImage = { src: string; width: number; height: number };

const STYLE = String.raw`
  :root {
    color-scheme: light dark;
    --bg: light-dark(#f3f4f6, #111418);
    --card: light-dark(#ffffff, #1b1f24);
    --well: light-dark(#f3f4f6, #111418);
    --hover: light-dark(#f6f8f9, #232830);
    --ink: light-dark(#1c2126, #e6e9ed);
    --muted: light-dark(#5f6773, #9ea7b2);
    --line: light-dark(#e2e6ea, #2e353d);
    --accent: light-dark(#0d9488, #2dd4bf);
    --accent-soft: light-dark(#e6f4f2, #12322f);
    --accent-soft-ink: light-dark(#0b7268, #8eeadb);
    --danger-ink: light-dark(#b42318, #fda29b);
    --danger-bg: light-dark(#fef6f5, #2a1816);
    --danger-line: light-dark(#f1b5ae, #7a2f28);
    --warn-ink: light-dark(#8a4b08, #f5c76b);
    --shadow: light-dark(rgb(25 35 45 / 0.06), rgb(0 0 0 / 0.32));
    /* The outline sits on screenshots, not on the theme, so it keeps one
       color that stands out from typical page content in either scheme. */
    --mark: #e5484d;
    --checker: repeating-conic-gradient(light-dark(#e4e7eb, #262c33) 0 25%, light-dark(#ffffff, #171a1f) 0 50%) 0 0 / 16px 16px;
    --frame-pad: 12px;
    --mono: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace;
    accent-color: var(--accent);
  }
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: 'Noto Sans JP', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic UI', system-ui, sans-serif;
    font-size: 15px;
    line-height: 1.7;
  }
  h1, h2, h3, p, figure, ul { margin: 0; }
  ul { padding: 0; list-style: none; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  main {
    display: grid;
    gap: 28px;
    max-width: 72rem;
    margin: 0 auto;
    padding: 44px 24px 72px;
  }

  .hero { display: grid; gap: 8px; margin-bottom: 8px; }
  .eyebrow { color: var(--muted); font-size: 13px; }
  .hero h1 {
    font-size: 26px;
    font-weight: 700;
    line-height: 1.3;
    text-wrap: balance;
    overflow-wrap: anywhere;
  }
  .lead { color: var(--muted); max-width: 46rem; text-wrap: pretty; }

  .section-title { font-size: 17px; font-weight: 700; line-height: 1.4; }

  .errors { display: grid; gap: 12px; }
  .errors > .section-title { color: var(--danger-ink); }
  .error {
    display: grid;
    gap: 6px;
    min-width: 0;
    padding: 16px 20px;
    border: 1px solid var(--danger-line);
    border-radius: 12px;
    background: var(--danger-bg);
  }
  .error h3 { font-size: 15px; font-weight: 700; overflow-wrap: anywhere; }
  .error-meta { color: var(--danger-ink); font-size: 13px; }
  .message {
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .card {
    display: grid;
    gap: 20px;
    min-width: 0;
    padding: 26px;
    border-radius: 20px;
    background: var(--card);
    box-shadow: 0 10px 30px var(--shadow);
  }
  .card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
  .card-head h2 { min-width: 0; overflow-wrap: anywhere; }
  .tag {
    padding: 1px 8px;
    border-radius: 6px;
    background: var(--accent-soft);
    color: var(--accent-soft-ink);
    font-size: 12px;
    font-weight: 450;
  }

  .change { display: grid; gap: 16px; min-width: 0; }
  .change + .change { margin-top: 20px; }
  .change-head { display: grid; gap: 2px; }
  .change h3 {
    font-size: 15px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .note { color: var(--muted); font-size: 13px; }
  .warnings { display: grid; gap: 2px; color: var(--warn-ink); font-size: 13px; overflow-wrap: anywhere; }
  .crops { display: grid; gap: 24px; }
  .area { display: grid; gap: 8px; }
  .area-label { color: var(--muted); font-size: 12px; }

  .pane { container: pane / inline-size; min-width: 0; }
  .pair {
    --track: calc(var(--w) + 2 * var(--frame-pad));
    display: grid;
    gap: 16px;
    align-items: start;
  }
  /* A crop is only worth showing at natural size, so Before and After sit
     side by side only while both fit and stack otherwise. */
  .pair.natural { grid-template-columns: repeat(auto-fit, min(100%, var(--track))); }
  /* Full pages rarely fit twice at natural size, so they shrink into two
     equal columns to stay side by side. */
  .pair.scaled { grid-template-columns: repeat(2, minmax(0, var(--track))); }
  @container pane (width < 34rem) {
    .pair.scaled { grid-template-columns: minmax(0, var(--track)); }
  }
  .shot { display: grid; gap: 6px; min-width: 0; }
  .shot figcaption { color: var(--muted); font-size: 13px; font-weight: 450; }
  .frame { min-width: 0; padding: var(--frame-pad); border-radius: 14px; background: var(--well); }
  .frame img {
    display: block;
    height: auto;
    box-shadow: 0 0 0 1px var(--line);
  }
  /* Transparent pixels are where a crop reaches past the edge of its page,
     so the checkerboard behind them reads as "no page here" rather than as
     a color of the page. */
  .canvas { position: relative; background: var(--checker); }
  .mark {
    position: absolute;
    min-width: 2px;
    min-height: 2px;
    outline: 2px solid var(--mark);
    outline-offset: 3px;
    border-radius: 2px;
    pointer-events: none;
  }

  summary { cursor: pointer; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary::before {
    content: '';
    flex: none;
    width: 7px;
    height: 7px;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    rotate: -45deg;
  }
  details[open] > summary::before { rotate: 45deg; }

  .full > summary {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 7px 18px 7px 16px;
    border-radius: 999px;
    background: var(--well);
    font-size: 14px;
    font-weight: 450;
  }
  .full-body { display: grid; gap: 16px; padding-top: 16px; }
  .views {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .views label {
    position: relative;
    padding: 6px 16px;
    border-radius: 999px;
    color: var(--muted);
    font-size: 14px;
    font-weight: 450;
    cursor: pointer;
  }
  /* The radio stays in the accessibility tree and keyboard order; the pill
     drawn by its label is what shows it. */
  .views input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .views label:has(:checked) {
    background: var(--well);
    color: var(--ink);
    outline: 1px solid transparent;
  }
  .views label:has(:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }

  .slider { display: grid; gap: 8px; }
  .slider-bar {
    position: sticky;
    top: 0;
    z-index: 1;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    padding-block: 8px;
    background: var(--card);
    color: var(--muted);
    font-size: 13px;
  }
  .slider-bar input { width: 100%; margin: 0; }
  .stack {
    --split: 50%;
    position: relative;
    max-width: 100%;
    overflow: hidden;
    background: var(--checker);
    box-shadow: 0 0 0 1px var(--line);
  }
  .stack img { position: absolute; top: 0; left: 0; height: auto; }
  .reveal { position: absolute; inset: 0; clip-path: inset(0 0 0 var(--split)); }
  .divider {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--split);
    width: 2px;
    margin-left: -1px;
    background: var(--accent);
    pointer-events: none;
  }

  .others { gap: 10px; }
  .lines { display: grid; gap: 2px; margin-inline: -12px; }
  .line > summary, .line-static {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 14px;
  }
  .line > summary::before { margin-top: 0.62em; }
  .line-static { padding-left: 31px; }
  .line-text { min-width: 0; overflow-wrap: anywhere; }
  .line-label { font-weight: 450; }
  .line-detail { color: var(--muted); font-size: 13px; }
  .line-status { display: block; color: var(--muted); font-size: 13px; }
  .line-status.noise { color: var(--warn-ink); }
  .line-status.unchanged { color: var(--accent-soft-ink); }
  .line-body { display: grid; gap: 16px; padding: 6px 12px 18px 31px; }

  @media (hover: hover) {
    .full > summary:hover, .views label:hover { color: var(--ink); }
    .line > summary:hover { background: var(--hover); }
  }
  @media (prefers-reduced-motion: no-preference) {
    summary::before { transition: rotate 0.15s ease-out; }
    .line > summary { transition: background 0.15s ease-out; }
  }

  @media (width < 40rem) {
    :root { --frame-pad: 8px; }
    main { gap: 20px; padding: 28px 16px 56px; }
    .card { gap: 16px; padding: 18px; border-radius: 16px; }
    .error { padding: 14px 16px; }
    .frame { border-radius: 12px; }
    .line-static { padding-left: 12px; }
    .line-body { padding-left: 12px; }
  }
`;

const SCRIPT = String.raw`
(() => {
  const andList = (items) =>
    items.length < 2 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items.at(-1);
  const jaList = (items) => items.join(items.length === 2 ? ' と ' : '、');
  const size = ([width, height]) => width + '×' + height;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const STRINGS = {
    en: {
      before: 'Before',
      after: 'After',
      diff: 'Diff',
      storybook: 'Storybook',
      list: andList,
      each: andList,
      comma: ', ',
      names: (labels) =>
        labels.length > 3 ? labels.slice(0, 3).join(', ') + ' and ' + (labels.length - 3) + ' more' : andList(labels),
      changedHeadline: (names) => names + ' changed',
      failedHeadline: (names) => names + ' could not be captured',
      unchangedHeadline: 'Nothing looks different',
      emptyHeadline: 'Nothing was captured',
      failedCount: (count) => count + ' not captured',
      noiseCount: (count) =>
        count === 1
          ? '1 changed only where it changes on every load'
          : count + ' changed only where they change on every load',
      unchangedCount: (count) => count + ' unchanged',
      skippedCount: (count) => count + ' left out',
      lead: (parts, followsNames) => (followsNames ? 'Also ' : '') + andList(parts) + '.',
      date: (month, day) => MONTHS[month - 1] + ' ' + day,
      widths: (widths) => andList(widths) + ' wide',
      darkMode: 'dark mode',
      bothModes: 'light and dark mode',
      qualified: (subject, detail) => subject + ' (' + detail + ')',
      errorsHeading: 'Not captured',
      phase: { before: 'Failed while capturing Before', after: 'Failed while capturing After' },
      sameChange: (count) => (count === 2 ? 'Both changed the same way.' : 'They all changed the same way.'),
      pageSize: (before, after) =>
        before[0] === after[0]
          ? 'The page height changed from ' + before[1] + 'px to ' + after[1] + 'px.'
          : 'The page size changed from ' + size(before) + ' to ' + size(after) + '.',
      warning: (message) => 'Note: ' + message,
      area: (index, count) => 'Spot ' + index + ' of ' + count,
      fullPage: 'full page',
      viewFullPage: 'View full page',
      close: 'Close',
      views: 'View',
      sideBySide: 'Side by side',
      slider: 'Slider',
      divider: 'Divider position',
      diffCaption: 'Diff: changed pixels in red',
      othersHeading: 'Others',
      noise: 'Only parts that change on every load (like a clock) changed',
      unchanged: 'Unchanged',
      skipped: (reason) => 'Left out: ' + reason,
      unstable: 'Difference between the two Before loads',
      alt: (kind, label, detail) => kind + ': ' + label + (detail ? ', ' + detail : ''),
    },
    ja: {
      before: '変更前',
      after: '変更後',
      diff: '差分',
      storybook: 'Storybook',
      list: jaList,
      each: (items) => items.join('、'),
      comma: '、',
      names: (labels) => {
        const quoted = labels.map((label) => '「' + label + '」');
        if (quoted.length === 2) return quoted.join('と');
        return quoted.slice(0, 3).join('') + (quoted.length > 3 ? 'ほか ' + (quoted.length - 3) + ' 件' : '');
      },
      changedHeadline: (names) => names + 'の見た目が変わりました',
      failedHeadline: (names) => names + 'を撮影できませんでした',
      unchangedHeadline: '見た目は変わっていません',
      emptyHeadline: '撮影したものはありません',
      failedCount: (count) => '撮影できなかったもの ' + count + ' 件',
      noiseCount: (count) => '毎回変わる部分だけが変わったもの ' + count + ' 件',
      unchangedCount: (count) => '変わらなかったもの ' + count + ' 件',
      skippedCount: (count) => '撮影しなかったもの ' + count + ' 件',
      lead: (parts, followsNames) => (followsNames ? 'ほかに、' : '') + parts.join('、') + 'があります',
      date: (month, day) => month + '月' + day + '日',
      widths: (widths) => '幅 ' + jaList(widths),
      darkMode: 'ダークモード',
      bothModes: 'ライトモードとダークモード',
      qualified: (subject, detail) => subject + '（' + detail + '）',
      errorsHeading: '撮影できなかったもの',
      phase: { before: '変更前の撮影で失敗', after: '変更後の撮影で失敗' },
      sameChange: (count) => (count === 2 ? 'どちらも同じ変わり方です' : 'どれも同じ変わり方です'),
      pageSize: (before, after) =>
        before[0] === after[0]
          ? 'ページの高さが ' + before[1] + 'px から ' + after[1] + 'px に変わりました'
          : 'ページの大きさが ' + size(before) + ' から ' + size(after) + ' に変わりました',
      warning: (message) => '注意：' + message,
      area: (index, count) => index + ' か所目（全 ' + count + ' か所）',
      fullPage: 'ページ全体',
      viewFullPage: 'ページ全体を見る',
      close: '閉じる',
      views: '表示方法',
      sideBySide: '並べて表示',
      slider: 'スライダー',
      divider: '境界の位置',
      diffCaption: '差分（変わったピクセルを赤で表示）',
      othersHeading: 'そのほか',
      noise: 'もともと毎回変わる部分（時計など）だけが変わりました',
      unchanged: '変わっていません',
      skipped: (reason) => '撮影しませんでした：' + reason,
      unstable: '変更前に 2 回読み込んだときの違い',
      alt: (kind, label, detail) => kind + '：' + label + (detail ? '、' + detail : ''),
    },
  };

  const read = (id) => JSON.parse(document.getElementById(id).textContent);
  const review = read('review');
  const images = read('images');
  const locale = navigator.language || 'en-US';
  const lang = locale.toLowerCase().startsWith('ja') ? 'ja' : 'en';
  const t = STRINGS[lang];
  document.documentElement.lang = lang;

  const unique = (values) => [...new Set(values)];

  const el = (tag, className, ...children) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.append(...children.filter((child) => child !== null && child !== undefined));
    return element;
  };

  const sizes = (viewports, all) => {
    const tall = (viewport) =>
      all.some((other) => other.width === viewport.width && other.height !== viewport.height);
    if (!viewports.some(tall)) return t.widths(viewports.map((viewport) => viewport.width + 'px'));
    return t.list(
      viewports.map((viewport) =>
        tall(viewport) ? size([viewport.width, viewport.height]) : t.widths([viewport.width + 'px']),
      ),
    );
  };

  const mode = (schemes) =>
    schemes.includes('dark') ? (schemes.includes('light') ? t.bothModes : t.darkMode) : null;

  // Variants that cover every story at every viewport and color scheme read
  // best as short lists; any other mix has to name each variant on its own.
  const conditions = (variants) => {
    const stories = unique(variants.flatMap((variant) => (variant.story === undefined ? [] : [variant.story])));
    const viewports = [
      ...new Map(variants.map(({ viewport }) => [size([viewport.width, viewport.height]), viewport])).values(),
    ];
    const schemes = unique(variants.map((variant) => variant.colorScheme));
    if (variants.length === Math.max(stories.length, 1) * viewports.length * schemes.length) {
      const settings = [sizes(viewports, viewports), mode(schemes)].filter(Boolean).join(t.comma);
      return stories.length === 0 ? settings : t.qualified(t.list(stories), settings);
    }
    return t.each(
      variants.map((variant) => {
        const shown = sizes([variant.viewport], viewports);
        const scheme = mode([variant.colorScheme]);
        if (variant.story !== undefined) {
          return t.qualified(variant.story, [shown, scheme].filter(Boolean).join(t.comma));
        }
        return scheme === null ? shown : t.qualified(shown, scheme);
      }),
    );
  };

  const imagesOf = (variant) =>
    variant && Object.hasOwn(images, variant.shotKey) ? images[variant.shotKey] : {};

  const frameOf = (shown) => ({
    width: Math.max(...shown.map((image) => image.width)),
    height: Math.max(...shown.map((image) => image.height)),
  });

  // pixelmatch compares images anchored at the top-left corner at one scale,
  // so each image is drawn at that scale in a frame as large as the largest
  // image it is compared with, instead of being fitted on its own.
  const layer = (image, frame, alt) => {
    const img = el('img');
    img.src = image.src;
    img.width = image.width;
    img.height = image.height;
    img.alt = alt;
    img.style.width = (image.width / frame.width) * 100 + '%';
    return img;
  };

  const picture = (image, caption, alt, frame, mark) => {
    const canvas = el('div', 'canvas', layer(image, frame, alt));
    canvas.style.width = 'min(100%, ' + frame.width + 'px)';
    canvas.style.aspectRatio = frame.width + ' / ' + frame.height;
    // The changed area is outlined so a change of a pixel or two can be found.
    if (mark) {
      const outline = el('span', 'mark');
      outline.setAttribute('aria-hidden', 'true');
      outline.style.left = (mark.x / frame.width) * 100 + '%';
      outline.style.top = (mark.y / frame.height) * 100 + '%';
      outline.style.width = (mark.width / frame.width) * 100 + '%';
      outline.style.height = (mark.height / frame.height) * 100 + '%';
      canvas.append(outline);
    }
    return el('figure', 'shot', el('figcaption', '', caption), el('div', 'frame', canvas));
  };

  const pair = (layout, shots, label, detail, mark) => {
    const shown = shots.filter(([image]) => image);
    const frame = frameOf(shown.map(([image]) => image));
    const element = el(
      'div',
      'pair ' + layout,
      ...shown.map(([image, kind]) => picture(image, kind, t.alt(kind, label, detail), frame, mark)),
    );
    element.style.setProperty('--w', frame.width + 'px');
    return el('div', 'pane', element);
  };

  const pages = (set, label, detail) =>
    pair(
      'scaled',
      [
        [set.before, t.before],
        [set.after, t.after],
        [set.unstable, t.unstable],
      ],
      label,
      detail,
    );

  // Opening a disclosure is what pays for decoding its full-page images, so
  // its content is built on the first open rather than with the page.
  const disclosure = (className, summary, build) => {
    const details = el('details', className, el('summary', '', ...summary));
    details.addEventListener('toggle', () => {
      if (details.open && details.childElementCount === 1) details.append(build());
    });
    return details;
  };

  const slider = (set, label) => {
    const frame = frameOf([set.before, set.after]);
    const divider = el('span', 'divider');
    divider.setAttribute('aria-hidden', 'true');
    const stack = el(
      'div',
      'stack',
      layer(set.before, frame, t.alt(t.before, label, t.fullPage)),
      el('div', 'reveal', layer(set.after, frame, t.alt(t.after, label, t.fullPage))),
      divider,
    );
    stack.style.width = 'min(100%, ' + frame.width + 'px)';
    stack.style.aspectRatio = frame.width + ' / ' + frame.height;
    const range = el('input');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.step = 'any';
    range.value = '50';
    range.setAttribute('aria-label', t.divider);
    range.addEventListener('input', () => {
      stack.style.setProperty('--split', range.value + '%');
    });
    return el('div', 'slider', el('div', 'slider-bar', el('span', '', t.before), range, el('span', '', t.after)), stack);
  };

  let viewGroups = 0;
  const fullPage = (set, label) => {
    const views = [
      { id: 'side', name: t.sideBySide, render: () => pages(set, label, t.fullPage) },
      set.before && set.after ? { id: 'slider', name: t.slider, render: () => slider(set, label) } : null,
      set.diff
        ? {
            id: 'diff',
            name: t.diff,
            render: () => el('div', 'pane', picture(set.diff, t.diffCaption, t.alt(t.diff, label), frameOf([set.diff]))),
          }
        : null,
    ].filter(Boolean);
    const group = 'view-' + ++viewGroups;
    const panel = el('div', '', views[0].render());
    const fieldset = el('fieldset', 'views', el('legend', 'visually-hidden', t.views));
    for (const view of views) {
      const input = el('input');
      input.type = 'radio';
      input.name = group;
      input.value = view.id;
      input.checked = view === views[0];
      input.addEventListener('change', () => {
        if (input.checked) panel.replaceChildren(view.render());
      });
      fieldset.append(el('label', '', input, view.name));
    }
    return el('div', 'full-body', fieldset, panel);
  };

  const changeBlock = (change, screen) => {
    const set = imagesOf(change.variants[0]);
    const warnings = unique(change.variants.flatMap((variant) => variant.warnings));
    const cropPair = (crop, detail) =>
      pair(
        'natural',
        [
          [crop.before, t.before],
          [crop.after, t.after],
        ],
        screen.label,
        detail,
        crop.mark,
      );
    const crops = change.fullPage
      ? pages(set, screen.label, t.fullPage)
      : el(
          'div',
          'crops',
          ...change.crops.map((crop, index, all) => {
            if (all.length === 1) return cropPair(crop);
            const area = t.area(index + 1, all.length);
            return el('div', 'area', el('p', 'area-label', area), cropPair(crop, area));
          }),
        );
    const full = disclosure('full', [t.viewFullPage], () => fullPage(set, screen.label));
    full.addEventListener('toggle', () => {
      full.firstChild.textContent = full.open ? t.close : t.viewFullPage;
    });
    return el(
      'div',
      'change',
      el(
        'div',
        'change-head',
        el('h3', '', conditions(change.variants)),
        change.dimensions ? el('p', 'note', t.pageSize(change.dimensions.before, change.dimensions.after)) : null,
        change.variants.length > 1 ? el('p', 'note', t.sameChange(change.variants.length)) : null,
        warnings.length > 0 ? el('ul', 'warnings', ...warnings.map((warning) => el('li', '', t.warning(warning)))) : null,
      ),
      crops,
      full,
    );
  };

  const card = ({ screen, changes }) =>
    el(
      'article',
      'card',
      el(
        'header',
        'card-head',
        el('h2', 'section-title', screen.label),
        screen.kind === 'component' ? el('span', 'tag', t.storybook) : null,
      ),
      ...changes.map((change) => changeBlock(change, screen)),
    );

  const section = (className, id, title, ...children) => {
    const element = el('section', className, el('h2', 'section-title', title), ...children);
    element.firstChild.id = id;
    element.setAttribute('aria-labelledby', id);
    return element;
  };

  const errorBlock = (entry) =>
    el(
      'article',
      'error',
      el('h3', '', entry.screen.label),
      el('p', 'error-meta', conditions(entry.variants) + ' · ' + t.phase[entry.phase]),
      el('p', 'message', entry.message),
    );

  const line = (kind, status, entry) => {
    const set = imagesOf(entry.variants[0]);
    const text = el(
      'span',
      'line-text',
      el('span', 'line-label', entry.screen.label),
      ' ',
      el('span', 'line-detail', conditions(entry.variants)),
      ' ',
      el('span', 'line-status ' + kind, status),
    );
    if (!set.before && !set.after && !set.unstable) return el('li', '', el('div', 'line-static', text));
    return el(
      'li',
      '',
      disclosure('line', [text], () => el('div', 'line-body', pages(set, entry.screen.label))),
    );
  };

  const dateOf = (iso) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const beforeDate = dateOf(review.beforeAt);
  const afterDate = dateOf(review.afterAt);
  const sameDay = beforeDate && afterDate && beforeDate.toDateString() === afterDate.toDateString();
  const clock = (date) => date.getHours() + ':' + String(date.getMinutes()).padStart(2, '0');
  const time = (iso, date) => {
    const text =
      date === null ? iso : sameDay ? clock(date) : t.date(date.getMonth() + 1, date.getDate()) + ' ' + clock(date);
    const element = el('time', '', text);
    element.dateTime = iso;
    return element;
  };

  const screensOf = (entries) => [...new Map(entries.map(({ screen }) => [screen.key, screen])).values()];
  const counted = new Set();
  const countOnce = (entries) => {
    const fresh = screensOf(entries).filter((screen) => !counted.has(screen.key));
    for (const screen of fresh) counted.add(screen.key);
    return fresh;
  };
  const changed = countOnce(review.changed);
  const failed = countOnce(review.errors);
  const noiseCount = countOnce(review.noise).length;
  const unchangedCount = countOnce(review.unchanged).length;
  const skippedCount = countOnce(review.skipped).length;
  const labels = (screens) => t.names(screens.map((screen) => screen.label));
  const headline =
    changed.length > 0
      ? t.changedHeadline(labels(changed))
      : failed.length > 0
        ? t.failedHeadline(labels(failed))
        : noiseCount + unchangedCount > 0
          ? t.unchangedHeadline
          : t.emptyHeadline;
  const counts = [
    changed.length > 0 && failed.length > 0 ? t.failedCount(failed.length) : null,
    noiseCount > 0 ? t.noiseCount(noiseCount) : null,
    unchangedCount > 0 ? t.unchangedCount(unchangedCount) : null,
    skippedCount > 0 ? t.skippedCount(skippedCount) : null,
  ].filter(Boolean);

  const hero = el(
    'header',
    'hero',
    el(
      'p',
      'eyebrow',
      t.before + ' ',
      time(review.beforeAt, beforeDate),
      ' · ' + t.after + ' ',
      time(review.afterAt, afterDate),
    ),
    el('h1', '', headline),
    counts.length > 0 ? el('p', 'lead', t.lead(counts, changed.length + failed.length > 0)) : null,
  );

  const lines = [
    ...review.noise.map((entry) => line('noise', t.noise, entry)),
    ...review.unchanged.map((entry) => line('unchanged', t.unchanged, entry)),
    ...review.skipped.map((entry) => line('skipped', t.skipped(entry.reason), entry)),
  ];

  document.getElementById('report').replaceChildren(
    ...[
      hero,
      review.errors.length > 0 ? section('errors', 'errors-heading', t.errorsHeading, ...review.errors.map(errorBlock)) : null,
      ...review.changed.map(card),
      lines.length > 0 ? section('card others', 'others-heading', t.othersHeading, el('ul', 'lines', ...lines)) : null,
    ].filter(Boolean),
  );
})();
`;

function sha256(source: string): string {
  return `'sha256-${createHash('sha256').update(source).digest('base64')}'`;
}

// The page may only run its own inline script and style and show data:
// images, so it can never reach the network, and markup smuggled in through
// a review string could not run even if it slipped past escaping.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  'img-src data:',
  `style-src ${sha256(STYLE)}`,
  `script-src ${sha256(SCRIPT)}`,
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Escaping every "<" rather than only "</" also defuses "<!--", after which
// the HTML parser would no longer end the script element at its </script>.
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function embed(png: Buffer): EmbeddedImage {
  // PNG keeps width and height at fixed offsets of its IHDR chunk; reading
  // them avoids decoding every screenshot just to size an <img>.
  return {
    src: `data:image/png;base64,${png.toString('base64')}`,
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

function embedReview(review: Review): unknown {
  return {
    ...review,
    changed: review.changed.map(({ screen, changes }) => ({
      screen,
      changes: changes.map(({ variants, crops, fullPage, dimensions }) => ({
        variants,
        fullPage,
        dimensions,
        crops: crops.map(({ area, box, before, after }) => ({
          before: embed(before),
          after: embed(after),
          mark: {
            x: area.x - box.x,
            y: area.y - box.y,
            width: area.width,
            height: area.height,
          },
        })),
      })),
    })),
  };
}

function embedImages(
  review: Review,
  images: ShotImages,
): Record<string, Partial<Record<ImageKind, EmbeddedImage>>> {
  // The page only ever shows some full pages of the first variant of each
  // entry, so embedding any other image would only grow the file.
  const shown = (
    entries: Array<{ variants: Variant[] }>,
    kinds: ImageKind[],
  ): Array<[Variant | undefined, ImageKind[]]> =>
    entries.map(({ variants }) => [variants[0], kinds]);
  const embedded: Record<
    string,
    Partial<Record<ImageKind, EmbeddedImage>>
  > = {};
  for (const [variant, kinds] of [
    ...shown(
      review.changed.flatMap(({ changes }) => changes),
      ['before', 'after', 'diff'],
    ),
    ...shown(review.noise, ['before', 'after', 'unstable']),
    ...shown([...review.unchanged, ...review.skipped], ['before', 'after']),
  ]) {
    const set = variant && images.get(variant.shotKey);
    if (!variant || !set) continue;
    const entry: Partial<Record<ImageKind, EmbeddedImage>> = {};
    for (const kind of kinds) {
      const png = set[kind];
      if (png) entry[kind] = embed(png);
    }
    embedded[variant.shotKey] = entry;
  }
  return embedded;
}

export function renderReport(review: Review, images: ShotImages): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">
<title>${escapeHtml(`ui-compare · ${review.id}`)}</title>
<style>${STYLE}</style>
</head>
<body>
<main id="report"></main>
<script type="application/json" id="review">${scriptJson(embedReview(review))}</script>
<script type="application/json" id="images">${scriptJson(embedImages(review, images))}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
