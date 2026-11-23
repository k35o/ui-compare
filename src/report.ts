import { createHash } from 'node:crypto';

import type { Summary } from './types.ts';

export type ReportImages = Map<
  string,
  { before?: Buffer; after?: Buffer; diff?: Buffer; unstable?: Buffer }
>;

type ImageKind = 'before' | 'after' | 'diff' | 'unstable';

type EmbeddedImage = { src: string; width: number; height: number };

const IMAGE_KINDS: ImageKind[] = ['before', 'after', 'diff', 'unstable'];

const STYLE = String.raw`
  :root {
    color-scheme: light dark;
    --surface: light-dark(oklch(0.975 0.001 235), oklch(0.25 0.0015 235));
    --canvas: light-dark(oklch(1 0 0), oklch(0.3 0.002 235));
    --well: light-dark(oklch(0.975 0.001 235), oklch(0.25 0.0015 235));
    --check: light-dark(oklch(0.945 0.0015 235), oklch(0.34 0.0025 235));
    --fg: light-dark(oklch(0.25 0.0015 235), oklch(0.975 0.001 235));
    --fg-mute: light-dark(oklch(0.52 0.006 235), oklch(0.75 0.005 235));
    --fg-subtle: light-dark(oklch(0.6 0.006 235), oklch(0.68 0.006 235));
    --line: light-dark(oklch(0.9 0.003 235), oklch(0.42 0.003 235));
    --line-subtle: light-dark(oklch(0.945 0.0015 235), oklch(0.36 0.0025 235));
    --hover: light-dark(oklch(0.945 0.0015 235), oklch(0.34 0.0025 235));
    --primary: light-dark(oklch(0.575 0.145 180), oklch(0.84 0.16 180));
    --selected-bg: light-dark(oklch(0.945 0.058 180), oklch(0.37 0.078 180));
    --selected-fg: light-dark(oklch(0.41 0.098 180), oklch(0.9 0.11 180));
    --mark-bg: light-dark(oklch(0.9 0.13 95), oklch(0.84 0.16 95));
    --mark-fg: light-dark(oklch(0.32 0.07 80), oklch(0.28 0.07 80));
    --changed-fg: light-dark(oklch(0.49 0.135 90), oklch(0.84 0.2 90));
    --changed-bg: light-dark(oklch(0.975 0.03 90), oklch(0.37 0.085 90));
    --changed-bd: light-dark(oklch(0.9 0.148 90), oklch(0.49 0.135 90));
    --changed-dot: light-dark(oklch(0.66 0.18 90), oklch(0.75 0.2 90));
    --error-fg: light-dark(oklch(0.49 0.22 25), oklch(0.84 0.15 25));
    --error-bg: light-dark(oklch(0.975 0.016 25), oklch(0.37 0.14 25));
    --error-bd: light-dark(oklch(0.9 0.084 25), oklch(0.49 0.22 25));
    --error-dot: light-dark(oklch(0.66 0.27 25), oklch(0.75 0.225 25));
    --unchanged-fg: light-dark(oklch(0.49 0.18 150), oklch(0.84 0.175 150));
    --unchanged-bg: light-dark(oklch(0.975 0.02 150), oklch(0.37 0.108 150));
    --unchanged-bd: light-dark(oklch(0.9 0.1 150), oklch(0.49 0.18 150));
    --unchanged-dot: light-dark(oklch(0.66 0.245 150), oklch(0.75 0.21 150));
    --skipped-fg: light-dark(oklch(0.55 0.02 280), oklch(0.78 0.03 280));
    --skipped-bg: light-dark(oklch(0.965 0.008 280), oklch(0.34 0.02 280));
    --skipped-bd: light-dark(oklch(0.88 0.02 280), oklch(0.46 0.03 280));
    --skipped-dot: light-dark(oklch(0.68 0.03 280), oklch(0.7 0.04 280));
    --unstable-fg: light-dark(oklch(0.5 0.012 250), oklch(0.8 0.012 250));
    --unstable-bg: light-dark(oklch(0.965 0.004 250), oklch(0.33 0.008 250));
    --unstable-bd: light-dark(oklch(0.75 0.012 250), oklch(0.55 0.012 250));
    --neutral-fg: var(--fg);
    --neutral-bg: var(--surface);
    --neutral-bd: var(--line);
    /* Outlines sit on top of screenshots, not on the theme, so each keeps one
       color that stands out from page content and from the red pixels of the
       diff image in either scheme. */
    --bbox-change: oklch(0.58 0.25 290);
    --bbox-noise: oklch(0.8 0.16 80);
    --shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.05);
    --shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
    --radius-sm: 0.375rem;
    --radius-md: 0.5rem;
    --radius-lg: 0.75rem;
    --mono: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, monospace;
    accent-color: var(--primary);
  }
  .changed { --c-fg: var(--changed-fg); --c-bg: var(--changed-bg); --c-bd: var(--changed-bd); --c-dot: var(--changed-dot); }
  .error { --c-fg: var(--error-fg); --c-bg: var(--error-bg); --c-bd: var(--error-bd); --c-dot: var(--error-dot); }
  .unchanged { --c-fg: var(--unchanged-fg); --c-bg: var(--unchanged-bg); --c-bd: var(--unchanged-bd); --c-dot: var(--unchanged-dot); }
  .skipped { --c-fg: var(--skipped-fg); --c-bg: var(--skipped-bg); --c-bd: var(--skipped-bd); --c-dot: var(--skipped-dot); }
  .unstable { --c-fg: var(--unstable-fg); --c-bg: var(--unstable-bg); --c-bd: var(--unstable-bd); }
  .neutral { --c-fg: var(--neutral-fg); --c-bg: var(--neutral-bg); --c-bd: var(--neutral-bd); }

  [hidden] { display: none !important; }
  html, body { height: 100%; }
  body {
    margin: 0;
    background: var(--surface);
    color: var(--fg);
    font-family: 'Noto Sans JP', ui-sans-serif, system-ui, 'Hiragino Sans', sans-serif;
    font-size: 0.875rem;
    line-height: 1.625;
  }
  button {
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    cursor: pointer;
  }
  :focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  figure { margin: 0; }
  h1, h2, h3, p, dl, dd { margin: 0; }
  .mono { font-family: var(--mono); }
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

  .app {
    display: grid;
    grid-template-columns: 19rem 1fr;
    height: 100dvh;
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--line-subtle);
    min-height: 0;
  }
  .side-head { padding: 1.75rem 1.5rem 1.25rem; }
  .eyebrow {
    font-size: 0.6875rem;
    color: var(--fg-subtle);
    margin-bottom: 0.875rem;
  }
  .verdict {
    font-size: 1.0625rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    line-height: 1.4;
    margin-bottom: 1rem;
  }
  .verdict .num { font-size: 1.75rem; font-variant-numeric: tabular-nums; }
  .verdict.ok { color: var(--unchanged-fg); }
  .ratio {
    display: flex;
    gap: 2px;
    height: 0.375rem;
    border-radius: 999px;
    overflow: hidden;
    margin-bottom: 1.25rem;
  }
  .ratio span { background: var(--c-dot); }
  .meta {
    color: var(--fg-subtle);
    font-size: 0.6875rem;
    line-height: 1.7;
  }
  .meta div, .facts div { display: flex; gap: 0.5rem; min-width: 0; }
  .meta dd { color: var(--fg-mute); overflow-wrap: anywhere; min-width: 0; }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    padding: 0 1.5rem 0.75rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    min-block-size: 1.5rem;
    padding: 0.125rem 0.75rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    color: var(--fg-subtle);
    font-size: 0.71875rem;
    font-weight: 450;
  }
  .chip .count { font-weight: 700; font-variant-numeric: tabular-nums; }
  .chip[aria-pressed='true'] {
    background: var(--c-bg);
    border-color: var(--c-bd);
    color: var(--c-fg);
  }

  .search {
    display: block;
    padding: 0 1.5rem 1rem;
    border-bottom: 1px solid var(--line-subtle);
  }
  .search-box { position: relative; display: flex; align-items: center; }
  .search-icon {
    position: absolute;
    left: 0.625rem;
    color: var(--fg-subtle);
    pointer-events: none;
  }
  .search input {
    box-sizing: border-box;
    width: 100%;
    padding: 0.4375rem 0.75rem 0.4375rem 2rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--line);
    background: var(--canvas);
    color: var(--fg);
    font: inherit;
    font-size: 0.8125rem;
  }
  .search input::placeholder { color: var(--fg-subtle); }
  /* The native clear affordance is unstyled OS chrome; Escape clears the
     query instead, so suppress it to keep the input on-palette. */
  .search input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; }

  .list {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem 0.875rem 1.25rem;
    min-height: 0;
  }
  .group-label {
    font-size: 0.6875rem;
    font-weight: 450;
    color: var(--c-fg);
    padding: 1rem 0.625rem 0.25rem;
  }
  .group:first-child .group-label { padding-top: 0.25rem; }
  .item {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: 100%;
    min-block-size: 2rem;
    text-align: start;
    padding: 0.375rem 0.625rem;
    border-radius: var(--radius-md);
    color: var(--fg-mute);
    font-size: 0.8125rem;
    line-height: 1.45;
  }
  .item:focus-visible { outline-offset: -2px; }
  .item[aria-selected='true'] {
    background: var(--selected-bg);
    color: var(--selected-fg);
    font-weight: 450;
  }
  .item .dot {
    flex: none;
    width: 0.4375rem;
    height: 0.4375rem;
    border-radius: 999px;
    background: var(--c-dot);
  }
  .item .text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .item .name, .item .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item .sub { font-size: 0.6875rem; color: var(--fg-subtle); font-weight: 400; font-variant-numeric: tabular-nums; }
  .item[aria-selected='true'] .sub { color: inherit; }
  .tag {
    flex: none;
    font-size: 0.625rem;
    font-weight: 450;
    padding: 0 0.375rem;
    border-radius: 999px;
    border: 1px dashed var(--unstable-bd);
    color: var(--unstable-fg);
  }
  mark {
    background: var(--mark-bg);
    color: var(--mark-fg);
    border-radius: 0.25rem;
    /* No horizontal padding: it would change a name's advance width and
       shift where an ellipsized row truncates as matches come and go. */
    padding: 0;
  }
  .list-empty {
    padding: 1.5rem 0.625rem;
    color: var(--fg-subtle);
    font-size: 0.75rem;
    overflow-wrap: anywhere;
  }

  .side-foot {
    padding: 0.875rem 1.5rem;
    border-top: 1px solid var(--line-subtle);
    color: var(--fg-subtle);
    font-size: 0.6875rem;
  }
  kbd {
    font-family: inherit;
    font-size: 0.625rem;
    border: 1px solid var(--line);
    border-radius: 0.25rem;
    padding: 0 0.3125rem;
    color: var(--fg-mute);
  }

  .detail {
    background: var(--canvas);
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .detail-head {
    display: flex;
    align-items: center;
    gap: 0.75rem 1rem;
    flex-wrap: wrap;
    padding: 1.25rem 2rem;
    border-bottom: 1px solid var(--line-subtle);
  }
  .title-block { min-width: 0; }
  .title-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .detail h2 {
    font-size: 1.0625rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
  }
  .badge {
    flex: none;
    font-size: 0.6875rem;
    font-weight: 450;
    line-height: 1.5;
    padding: 0.0625rem 0.625rem;
    border-radius: 999px;
    background: var(--c-bg);
    border: 1px solid var(--c-bd);
    color: var(--c-fg);
  }
  .badge.unstable { border-style: dashed; }
  .path {
    font-size: 0.71875rem;
    color: var(--fg-subtle);
    overflow-wrap: anywhere;
  }
  .head-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.875rem;
    flex-wrap: wrap;
  }
  .modes {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.125rem;
    padding: 0.1875rem;
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .modes button {
    min-block-size: 1.5rem;
    padding: 0.125rem 0.75rem;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    font-weight: 450;
    color: var(--fg-mute);
  }
  .modes button[aria-pressed='true'] {
    background: var(--canvas);
    color: var(--fg);
    box-shadow: var(--shadow-xs);
  }
  .pager { display: inline-flex; gap: 0.25rem; }
  .pager button {
    width: 1.75rem;
    height: 1.75rem;
    display: grid;
    place-items: center;
    border-radius: 999px;
    border: 1px solid var(--line);
    color: var(--fg-mute);
  }
  .pager button[aria-disabled='true'] { opacity: 0.4; cursor: default; }
  .facts {
    flex-basis: 100%;
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1.5rem;
    font-size: 0.75rem;
  }
  .facts dt { color: var(--fg-subtle); }
  .facts dd { color: var(--fg-mute); font-variant-numeric: tabular-nums; }

  .stage {
    flex: 1;
    overflow-y: auto;
    padding: 2rem;
  }
  /* The stage reaches the viewport edges, where an outset ring is cut off. */
  .stage:focus-visible { outline-offset: -2px; }
  .notes {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }
  .note {
    padding: 0.75rem 1rem;
    border-radius: var(--radius-lg);
    border: 1px solid var(--c-bd);
    background: var(--c-bg);
    font-size: 0.8125rem;
    overflow-wrap: anywhere;
  }
  .note.unstable { border-style: dashed; }
  .note h3 {
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--c-fg);
    margin-bottom: 0.25rem;
  }
  .note .message {
    font-family: var(--mono);
    font-size: 0.75rem;
    white-space: pre-wrap;
  }
  .note ul { margin: 0; padding-left: 1.25rem; }
  .columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
    gap: 1.25rem;
    align-items: start;
  }
  .columns figure { min-width: 0; }
  figcaption, .slider-labels {
    font-size: 0.6875rem;
    font-weight: 450;
    color: var(--fg-subtle);
    margin-bottom: 0.375rem;
  }
  .shot {
    display: flex;
    justify-content: center;
    /* The mat keeps screenshot pixels away from the rounded corners so
       content at the viewport edges is never clipped. */
    padding: 0.625rem;
    border: 1px solid var(--line-subtle);
    border-radius: var(--radius-lg);
    background:
      repeating-conic-gradient(var(--check) 0% 25%, transparent 0% 50%)
      0 0 / 14px 14px var(--well);
    overflow: hidden;
  }
  .canvas { position: relative; min-width: 0; max-width: 100%; }
  .canvas img {
    display: block;
    max-width: 100%;
    height: auto;
    box-shadow: 0 0 0 1px var(--line-subtle);
  }
  .bbox {
    position: absolute;
    left: var(--left);
    top: var(--top);
    width: var(--width);
    height: var(--height);
    outline: 2px solid var(--bbox-change);
    outline-offset: 2px;
    box-shadow: 0 0 0 2px rgb(255 255 255 / 0.85);
    pointer-events: none;
  }
  .bbox.noise { outline: 2px dashed var(--bbox-noise); }

  .slider-labels { display: flex; justify-content: space-between; }
  .stack { display: grid; position: relative; }
  .stack > .shot { grid-area: 1 / 1; }
  .stack > .reveal { clip-path: inset(0 0 0 var(--clip, 50%)); }
  .stack > .divider {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--clip, 50%);
    width: 2px;
    translate: -1px 0;
    background: var(--primary);
    pointer-events: none;
  }
  .stack > .divider::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    translate: -50% -50%;
    width: 0.875rem;
    height: 0.875rem;
    border-radius: 999px;
    background: var(--primary);
    box-shadow: var(--shadow-sm);
  }
  .slider input[type='range'] {
    display: block;
    width: 100%;
    margin-top: 0.875rem;
  }

  .empty {
    height: 100%;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 0.75rem;
    padding: 2rem;
    text-align: center;
    color: var(--fg-mute);
  }
  .empty h2 { color: var(--fg); }
  .empty p { max-width: 32rem; }
  .show-all {
    min-block-size: 2rem;
    padding: 0.25rem 1rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    color: var(--fg);
  }

  @media (hover: hover) {
    .chip:hover:not([aria-pressed='true']) { border-color: var(--c-bd); }
    .search input:hover { border-color: var(--fg-subtle); }
    .item:hover:not([aria-selected='true']) { background: var(--hover); }
    .pager button:hover:not([aria-disabled='true']), .show-all:hover { background: var(--hover); }
  }
  @media (prefers-reduced-motion: no-preference) {
    .chip, .item, .modes button, .pager button, .search input, .show-all {
      transition: background-color 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out;
    }
  }
  @media (forced-colors: active) {
    .chip[aria-pressed='true'], .modes button[aria-pressed='true'], .item[aria-selected='true'] {
      border-color: Highlight;
      outline: 2px solid Highlight;
      outline-offset: -2px;
    }
    .bbox { outline-color: Highlight; }
  }
  @media (max-width: 56rem) {
    .app { grid-template-columns: minmax(0, 1fr); height: auto; }
    .sidebar { border-right: none; border-bottom: 1px solid var(--line-subtle); }
    .list { max-height: 18rem; }
    .detail-head { padding: 1.25rem; }
    .stage { padding: 1.25rem; }
  }
`;

const BODY = String.raw`<div class="app">
  <aside class="sidebar" aria-label="Run overview">
    <header class="side-head">
      <p class="eyebrow mono">ui-compare</p>
      <h1 class="verdict" id="verdict"></h1>
      <div class="ratio" id="ratio" aria-hidden="true"></div>
      <dl class="meta" id="meta"></dl>
    </header>
    <div class="filters" id="filters" role="group" aria-label="Filter by status"></div>
    <search class="search" id="search-box">
      <div class="search-box">
        <svg class="search-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14" stroke-linecap="round" />
        </svg>
        <input id="search" type="search" placeholder="URL, story or viewport…" aria-label="Filter shots" role="combobox" aria-expanded="true" aria-controls="list" aria-autocomplete="list" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
      </div>
    </search>
    <p class="visually-hidden" id="search-status" role="status"></p>
    <div class="list" id="list" role="listbox" aria-label="Shots"></div>
    <footer class="side-foot" id="side-foot">
      <kbd>↑</kbd> <kbd>↓</kbd> navigate · <kbd>1</kbd>–<kbd>5</kbd> mode · <kbd>/</kbd> search
    </footer>
  </aside>
  <main class="detail" id="detail"></main>
</div>`;

const SCRIPT = String.raw`
(() => {
  const summary = JSON.parse(document.getElementById('summary').textContent);
  const images = JSON.parse(document.getElementById('images').textContent);
  const STATUSES = ['changed', 'error', 'unchanged', 'skipped'];
  const both = (item) => Boolean(item.images.before && item.images.after);
  const MODES = [
    { id: 'side-by-side', key: '1', available: (item) => Boolean(item.images.before || item.images.after) },
    { id: 'slider', key: '2', available: both },
    { id: 'blink', key: '3', available: both },
    { id: 'diff', key: '4', available: (item) => Boolean(item.images.diff) },
    { id: 'unstable', key: '5', available: (item) => Boolean(item.images.unstable) },
  ];

  const list = document.getElementById('list');
  const detail = document.getElementById('detail');
  const search = document.getElementById('search');

  const state = {
    visible: new Set(['changed', 'error']),
    selected: null,
    mode: 'side-by-side',
    query: '',
  };
  let shown = { key: null, mode: null };

  const el = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const size = (width, height) => width + '×' + height;
  const boxLabel = (box) => 'x ' + box.x + ', y ' + box.y + ', ' + size(box.width, box.height);
  // A ratio that rounds to 0.00% still means some pixels changed.
  const percent = (ratio) =>
    ratio > 0 && ratio < 0.0001 ? '<0.01%' : (ratio * 100).toFixed(2) + '%';
  const plural = (count, noun) => count + ' ' + noun + (count === 1 ? '' : 's');
  const targetTitle = (target) =>
    target.kind === 'story' ? target.title + ' / ' + target.name : target.url;
  // While an IME is composing, arrow keys and Escape pick and dismiss
  // conversion candidates. Safari reports the confirming keydown with
  // isComposing already false, but still with keyCode 229.
  const composing = (event) => event.isComposing || event.keyCode === 229;

  const items = STATUSES.flatMap((status) =>
    summary.shots.filter((result) => result.status === status),
  ).map((result, index) => {
    const { target, viewport, colorScheme } = result.shot;
    const name =
      target.kind === 'story' ? targetTitle(target) : target.url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    const sub = [size(viewport.width, viewport.height), colorScheme]
      .concat(result.status === 'changed' && result.diff ? [percent(result.diff.mismatchRatio)] : [])
      .join(' · ');
    return {
      index,
      key: result.shot.key,
      status: result.status,
      result,
      name,
      sub,
      haystack: [
        name,
        sub,
        // Lets a query typed with a plain "x" find the "×" in the label.
        viewport.width + 'x' + viewport.height,
        target.url,
        target.kind === 'story' ? target.storyId : '',
      ]
        .join(' ')
        .toLowerCase(),
      images: Object.hasOwn(images, result.shot.key) ? images[result.shot.key] : {},
    };
  });

  const queryTerms = () => state.query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (item, terms) => terms.every((term) => item.haystack.includes(term));
  const visibleItems = () => {
    const terms = queryTerms();
    return items.filter((item) => state.visible.has(item.status) && matches(item, terms));
  };

  const counts = summary.counts;
  const review = counts.changed + counts.error;
  const verdict = document.getElementById('verdict');
  if (items.length === 0) {
    verdict.textContent = 'Nothing captured';
  } else if (review > 0) {
    verdict.append(el('span', 'num', String(review)), ' ' + (review === 1 ? 'shot' : 'shots') + ' to review');
  } else {
    verdict.classList.add('ok');
    // Never claim "no changes" for shots that were not compared.
    verdict.textContent =
      counts.skipped > 0
        ? counts.unchanged + ' unchanged · ' + counts.skipped + ' skipped'
        : 'No changes in ' + plural(counts.unchanged, 'shot');
  }

  const ratio = document.getElementById('ratio');
  for (const status of STATUSES) {
    if (counts[status] === 0) continue;
    const segment = el('span', status);
    segment.style.flexGrow = String(counts[status]);
    ratio.append(segment);
  }

  const term = (label, value) => {
    const row = el('div');
    const description = el('dd');
    description.append(value);
    row.append(el('dt', '', label), description);
    return row;
  };
  const time = (iso) => {
    const element = el('time');
    element.dateTime = iso;
    const date = new Date(iso);
    element.textContent = Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
    return element;
  };
  document.getElementById('meta').append(
    term('Run', el('span', 'mono', summary.id)),
    term('Before', time(summary.beforeAt)),
    term('After', time(summary.afterAt)),
  );

  const chips = new Map();
  const filters = document.getElementById('filters');
  for (const status of STATUSES) {
    const chip = el('button', 'chip ' + status);
    chip.type = 'button';
    chip.append(el('span', 'count', String(counts[status])), ' ' + status);
    chip.addEventListener('click', () => {
      if (state.visible.has(status)) state.visible.delete(status);
      else state.visible.add(status);
      reselect();
      update();
    });
    chips.set(status, chip);
    filters.append(chip);
  }

  search.addEventListener('input', () => {
    state.query = search.value;
    reselect();
    update();
  });
  search.addEventListener('keydown', (event) => {
    if (composing(event)) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    if (event.key === 'Escape') {
      if (search.value) {
        search.value = '';
        state.query = '';
        reselect();
        update();
      } else {
        search.blur();
      }
    }
  });

  const outlineBox = (box, image, tone) => {
    const outline = el('span', 'bbox ' + tone);
    outline.setAttribute('aria-hidden', 'true');
    outline.style.setProperty('--left', (box.x / image.width) * 100 + '%');
    outline.style.setProperty('--top', (box.y / image.height) * 100 + '%');
    outline.style.setProperty('--width', (box.width / image.width) * 100 + '%');
    outline.style.setProperty('--height', (box.height / image.height) * 100 + '%');
    return outline;
  };

  const paint = (img, image, alt, frame) => {
    img.src = image.src;
    img.width = image.width;
    img.height = image.height;
    img.style.width = (image.width / frame.width) * 100 + '%';
    img.alt = alt;
  };

  // pixelmatch compares Before and After anchored at the top-left corner at
  // one scale, so the viewers that overlay them must draw both in that frame
  // rather than fit and center each image on its own.
  const sharedFrame = (item) => ({
    width: Math.max(item.images.before.width, item.images.after.width),
    height: Math.max(item.images.before.height, item.images.after.height),
  });

  const picture = (image, alt, outline, frame = image) => {
    const mat = el('span', 'shot');
    const canvas = el('span', 'canvas');
    canvas.style.width = frame.width + 'px';
    canvas.style.aspectRatio = frame.width + ' / ' + frame.height;
    const img = el('img');
    paint(img, image, alt, frame);
    canvas.append(img);
    if (outline) canvas.append(outlineBox(outline.box, image, outline.tone));
    mat.append(canvas);
    return mat;
  };

  const figure = (image, caption, alt, outline) => {
    const element = el('figure');
    element.append(el('figcaption', '', caption), picture(image, alt, outline));
    return element;
  };

  const changeOutline = (item) => {
    const diff = item.result.diff;
    return item.status === 'changed' && diff && diff.bbox ? { box: diff.bbox, tone: 'change' } : null;
  };

  const VIEWERS = {
    'side-by-side'(item) {
      const columns = el('div', 'columns');
      if (item.images.before) columns.append(figure(item.images.before, 'Before', 'Before screenshot'));
      if (item.images.after) {
        columns.append(figure(item.images.after, 'After', 'After screenshot', changeOutline(item)));
      }
      return columns;
    },
    slider(item) {
      const wrap = el('div', 'slider');
      const labels = el('div', 'slider-labels');
      labels.append(el('span', '', 'Before'), el('span', '', 'After'));
      const frame = sharedFrame(item);
      const stack = el('div', 'stack');
      const after = picture(item.images.after, 'After screenshot', null, frame);
      after.classList.add('reveal');
      stack.append(picture(item.images.before, 'Before screenshot', null, frame), after, el('span', 'divider'));
      const range = el('input');
      range.type = 'range';
      range.min = '0';
      range.max = '100';
      range.value = '50';
      range.setAttribute('aria-label', 'Divider position');
      range.addEventListener('input', () => {
        stack.style.setProperty('--clip', range.value + '%');
      });
      wrap.append(labels, stack, range);
      return wrap;
    },
    blink(item) {
      const frame = sharedFrame(item);
      const element = el('figure');
      const caption = el('figcaption', '', 'Before');
      const mat = picture(item.images.before, 'Before screenshot', null, frame);
      const img = mat.querySelector('img');
      let showAfter = false;
      const timer = setInterval(() => {
        if (!img.isConnected) {
          clearInterval(timer);
          return;
        }
        showAfter = !showAfter;
        const label = showAfter ? 'After' : 'Before';
        paint(img, showAfter ? item.images.after : item.images.before, label + ' screenshot', frame);
        caption.textContent = label;
      }, 700);
      element.append(caption, mat);
      return element;
    },
    diff(item) {
      return figure(item.images.diff, 'Diff', 'Diff', changeOutline(item));
    },
    unstable(item) {
      const unstable = item.result.unstable;
      return figure(
        item.images.unstable,
        'Unstable: Before loaded twice',
        'Unstable diff',
        unstable && unstable.bbox ? { box: unstable.bbox, tone: 'noise' } : null,
      );
    },
  };

  // Wrap matched substrings in <mark> via text nodes only, so summary
  // strings never reach the DOM as markup.
  function highlight(text, terms) {
    const fragment = document.createDocumentFragment();
    const lower = text.toLowerCase();
    let cursor = 0;
    while (cursor < text.length) {
      let at = -1;
      let length = 0;
      for (const term of terms) {
        const index = lower.indexOf(term, cursor);
        // On a tie, prefer the longer term so overlapping matches merge
        // into one <mark> instead of fragmenting.
        if (index !== -1 && (at === -1 || index < at || (index === at && term.length > length))) {
          at = index;
          length = term.length;
        }
      }
      if (at === -1) {
        fragment.append(text.slice(cursor));
        break;
      }
      if (at > cursor) fragment.append(text.slice(cursor, at));
      fragment.append(el('mark', '', text.slice(at, at + length)));
      cursor = at + length;
    }
    return fragment;
  }

  function emptyMessage() {
    const statusOnly = items.filter((item) => state.visible.has(item.status));
    if (queryTerms().length > 0 && statusOnly.length > 0) {
      return 'No shots match “' + state.query + '”.';
    }
    if (state.visible.has('changed') && state.visible.has('error') && review === 0) {
      return 'Nothing changed and nothing failed.';
    }
    return 'Nothing to show for the selected statuses.';
  }

  // Rewriting an unchanged message would make screen readers announce the
  // count again on every move within the same result set.
  function syncStatus(count) {
    const status = document.getElementById('search-status');
    const message = count === 0 ? emptyMessage() : plural(count, 'result');
    if (status.textContent !== message) status.textContent = message;
  }

  function option(item, terms) {
    const button = el('button', 'item ' + item.status);
    button.type = 'button';
    button.id = 'opt-' + item.index;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(item.key === state.selected));
    button.tabIndex = -1;
    button.dataset.focus = 'option';
    const name = el('span', 'name');
    name.append(highlight(item.name, terms));
    name.title = item.name;
    const sub = el('span', 'sub');
    sub.append(highlight(item.sub, terms));
    const text = el('span', 'text');
    text.append(name, sub);
    button.append(el('span', 'dot'), text);
    if (item.result.unstable) button.append(el('span', 'tag', 'unstable'));
    button.addEventListener('click', () => {
      state.selected = item.key;
      update();
    });
    return button;
  }

  function renderList(flat) {
    list.replaceChildren();
    search.removeAttribute('aria-activedescendant');
    const terms = queryTerms();
    syncStatus(flat.length);
    if (flat.length === 0) {
      list.append(el('p', 'list-empty', emptyMessage()));
      return;
    }
    for (const status of STATUSES) {
      const members = flat.filter((item) => item.status === status);
      if (members.length === 0) continue;
      const group = el('div', 'group');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-labelledby', 'group-' + status);
      const label = el('div', 'group-label ' + status, status + ' · ' + members.length);
      label.id = 'group-' + status;
      group.append(label);
      for (const item of members) group.append(option(item, terms));
      list.append(group);
    }
    // Only one option is a tab stop; arrow keys move between the rest.
    const selected = list.querySelector('[aria-selected="true"]');
    (selected || list.querySelector('[role="option"]')).tabIndex = 0;
    if (selected) search.setAttribute('aria-activedescendant', selected.id);
  }

  function notes(item) {
    const result = item.result;
    const note = (tone, heading, ...body) => {
      const element = el('div', 'note ' + tone);
      element.append(el('h3', '', heading), ...body);
      return element;
    };
    const out = [];
    if (result.error) {
      out.push(
        note(
          'error',
          'Capture failed during ' + (result.error.phase === 'before' ? 'Before' : 'After'),
          el('p', 'message', result.error.message),
        ),
      );
    }
    if (result.skipReason !== undefined) {
      out.push(note('skipped', 'Skipped', el('p', '', result.skipReason)));
    }
    if (result.unstable) {
      const unstable = result.unstable;
      out.push(
        note(
          'unstable',
          'Unstable',
          el(
            'p',
            '',
            'This page already differed between two loads before the change (' +
              percent(unstable.mismatchRatio) +
              ' of pixels' +
              (unstable.bbox ? ', ' + boxLabel(unstable.bbox) : '') +
              '). ' +
              (unstable.bbox
                ? 'Differences inside that box may be noise.'
                : 'Some differences may be noise.'),
          ),
        ),
      );
    }
    if (result.warnings.length > 0) {
      const warnings = el('ul');
      for (const warning of result.warnings) warnings.append(el('li', '', warning));
      out.push(note('neutral', 'Warnings', warnings));
    }
    return out;
  }

  function facts(item) {
    const { viewport, colorScheme } = item.result.shot;
    const list = el('dl', 'facts');
    list.append(term('Viewport', size(viewport.width, viewport.height)), term('Color scheme', colorScheme));
    const diff = item.result.diff;
    if (item.status === 'changed' && diff) {
      list.append(
        term('Mismatch', percent(diff.mismatchRatio) + ' · ' + diff.mismatchedPixels.toLocaleString() + ' px'),
      );
      if (diff.bbox) list.append(term('Changed area', boxLabel(diff.bbox)));
      if (diff.dimensions) {
        list.append(
          term('Size', size(...diff.dimensions.before) + ' → ' + size(...diff.dimensions.after)),
        );
      }
    }
    return list;
  }

  function emptyState(flat) {
    const box = el('div', 'empty');
    if (items.length === 0) {
      box.append(
        el('h2', '', 'No shots in this run'),
        el(
          'p',
          '',
          'Nothing was captured, so there is nothing to compare. Pass page URLs or Storybook stories to ui-compare before, then run ui-compare after.',
        ),
      );
      return box;
    }
    if (flat.length > 0) {
      box.append(el('p', '', 'Select a shot from the list.'));
      return box;
    }
    box.append(el('p', '', emptyMessage()));
    const terms = queryTerms();
    if (items.some((item) => !state.visible.has(item.status) && matches(item, terms))) {
      const showAll = el('button', 'show-all', 'Show all statuses');
      showAll.type = 'button';
      showAll.addEventListener('click', () => {
        state.visible = new Set(STATUSES);
        reselect();
        update();
        list.querySelector('[aria-selected="true"]')?.focus();
      });
      box.append(showAll);
    }
    return box;
  }

  function renderDetail(flat, item, modes, mode) {
    const previous = detail.querySelector('.stage');
    // The viewers differ in height, so a mode change carries the reading
    // position over as a fraction to stay at the same spot of a tall shot.
    const offset =
      item && item.key === shown.key && previous ? previous.scrollTop / previous.scrollHeight : 0;
    shown = { key: item ? item.key : null, mode: mode ? mode.id : null };
    detail.replaceChildren();
    if (!item) {
      detail.append(emptyState(flat));
      return;
    }
    const { target } = item.result.shot;

    const head = el('header', 'detail-head');
    const titleBlock = el('div', 'title-block');
    const titleRow = el('div', 'title-row');
    titleRow.append(el('h2', '', targetTitle(target)), el('span', 'badge ' + item.status, item.status));
    if (item.result.unstable) titleRow.append(el('span', 'badge unstable', 'unstable'));
    titleBlock.append(titleRow);
    if (target.kind === 'story') titleBlock.append(el('div', 'path mono', target.storyId));

    const actions = el('div', 'head-actions');
    if (modes.length > 1) {
      const group = el('span', 'modes');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', 'Comparison mode');
      for (const candidate of modes) {
        const button = el('button', '', candidate.id);
        button.type = 'button';
        button.dataset.focus = 'mode-' + candidate.id;
        button.setAttribute('aria-pressed', String(candidate === mode));
        button.setAttribute('aria-keyshortcuts', candidate.key);
        button.addEventListener('click', () => {
          state.mode = candidate.id;
          update();
        });
        group.append(button);
      }
      actions.append(group);
    }
    const pager = el('span', 'pager');
    for (const [glyph, delta, label, shortcut] of [
      ['↑', -1, 'Previous shot', 'ArrowUp'],
      ['↓', 1, 'Next shot', 'ArrowDown'],
    ]) {
      const button = el('button', '', glyph);
      button.type = 'button';
      button.dataset.focus = label;
      button.dataset.delta = String(delta);
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-keyshortcuts', shortcut);
      button.addEventListener('click', () => move(delta));
      pager.append(button);
    }
    actions.append(pager);
    head.append(titleBlock, actions, facts(item));

    const stage = el('div', 'stage');
    stage.tabIndex = 0;
    stage.dataset.focus = 'stage';
    stage.setAttribute('role', 'region');
    stage.setAttribute('aria-label', 'Comparison');
    const itemNotes = notes(item);
    if (itemNotes.length > 0) {
      const wrap = el('div', 'notes');
      wrap.append(...itemNotes);
      stage.append(wrap);
    }
    if (mode) stage.append(VIEWERS[mode.id](item));
    else if (itemNotes.length === 0) stage.append(el('p', 'list-empty', 'No screenshots for this shot.'));
    detail.append(head, stage);
    if (offset > 0) stage.scrollTop = offset * stage.scrollHeight;
  }

  // aria-disabled keeps the button focusable, so focus survives reaching
  // either end of the list.
  function syncPager(flat, item) {
    const index = flat.indexOf(item);
    for (const button of detail.querySelectorAll('.pager button')) {
      const next = index + Number(button.dataset.delta);
      if (next < 0 || next >= flat.length) button.setAttribute('aria-disabled', 'true');
      else button.removeAttribute('aria-disabled');
    }
  }

  function reselect() {
    const flat = visibleItems();
    if (!flat.some((item) => item.key === state.selected)) {
      state.selected = flat[0]?.key ?? null;
    }
  }

  // Rebuilding a pane drops keyboard focus on the floor, so carry it over to
  // the rebuilt control. The detail is rebuilt only for another shot or
  // mode, which keeps its scroll position and slider through filtering.
  function update() {
    const token = document.activeElement?.dataset?.focus;
    for (const [status, chip] of chips) {
      chip.setAttribute('aria-pressed', String(state.visible.has(status)));
    }
    const flat = visibleItems();
    renderList(flat);
    const item = flat.find((candidate) => candidate.key === state.selected);
    const modes = item ? MODES.filter((candidate) => candidate.available(item)) : [];
    // Keep the chosen mode in state even when this shot cannot show it, so
    // moving on to a shot that can restores it.
    const mode = modes.find((candidate) => candidate.id === state.mode) || modes[0];
    if (!item || item.key !== shown.key || (mode ? mode.id : null) !== shown.mode) {
      renderDetail(flat, item, modes, mode);
    }
    syncPager(flat, item);
    if (token === 'option') list.querySelector('[aria-selected="true"]')?.focus();
    else if (token) detail.querySelector('[data-focus="' + token + '"]')?.focus();
  }

  function move(delta) {
    const flat = visibleItems();
    if (flat.length === 0) return;
    const index = flat.findIndex((item) => item.key === state.selected);
    const next = flat[index === -1 ? 0 : Math.min(Math.max(index + delta, 0), flat.length - 1)];
    if (next.key === state.selected) return;
    state.selected = next.key;
    update();
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.target === search || composing(event)) return;
    if (event.key === '/') {
      event.preventDefault();
      search.focus();
      search.select();
      return;
    }
    // The stage scrolls with the arrow keys, and its slider moves with them.
    if (!(event.target instanceof Element && event.target.closest('.stage'))) {
      if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
      if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    }
    const mode = MODES.find((candidate) => candidate.key === event.key);
    const item = items.find((candidate) => candidate.key === state.selected);
    if (mode && item && mode.available(item)) {
      state.mode = mode.id;
      update();
    }
  });

  if (items.length === 0) {
    for (const id of ['filters', 'search-box', 'list', 'side-foot']) {
      document.getElementById(id).hidden = true;
    }
  }
  reselect();
  update();
})();
`;

function sha256(source: string): string {
  return `'sha256-${createHash('sha256').update(source).digest('base64')}'`;
}

// The page may only run its own inline script and style and show data:
// images, so it can never reach the network, and markup smuggled in through
// a summary string could not run even if it slipped past escaping.
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
  // them avoids decoding every full-page screenshot just to size an <img>.
  return {
    src: `data:image/png;base64,${png.toString('base64')}`,
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

function embedImages(
  images: ReportImages,
): Record<string, Partial<Record<ImageKind, EmbeddedImage>>> {
  const embedded: Record<
    string,
    Partial<Record<ImageKind, EmbeddedImage>>
  > = {};
  for (const [key, set] of images) {
    const entry: Partial<Record<ImageKind, EmbeddedImage>> = {};
    for (const kind of IMAGE_KINDS) {
      const png = set[kind];
      if (png) entry[kind] = embed(png);
    }
    embedded[key] = entry;
  }
  return embedded;
}

export function renderReport(summary: Summary, images: ReportImages): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">
<title>${escapeHtml(`ui-compare · ${summary.id}`)}</title>
<style>${STYLE}</style>
</head>
<body>
${BODY}
<script type="application/json" id="summary">${scriptJson(summary)}</script>
<script type="application/json" id="images">${scriptJson(embedImages(images))}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
