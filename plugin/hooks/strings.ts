export type Lang = 'en' | 'ja';

export type Strings = {
  before: string;
  after: string;
  dark: string;
  storybook: string;
  run: (id: string) => string;
  changedHeadline: (count: number) => string;
  failedHeadline: (count: number) => string;
  unchangedHeadline: string;
  emptyHeadline: string;
  failedCount: (count: number) => string;
  noiseCount: (count: number) => string;
  unchangedCount: (count: number) => string;
  skippedCount: (count: number) => string;
  lead: (counts: string) => string;
  list: (items: readonly string[]) => string;
  errorsHeading: string;
  phase: { before: string; after: string };
  sameChange: string;
  pageSize: (before: readonly number[], after: readonly number[]) => string;
  warning: (message: string) => string;
  area: (index: number, count: number) => string;
  fullPage: string;
  viewFullPage: string;
  hideFullPage: string;
  showPage: string;
  hidePage: string;
  pageHint: string;
  othersHeading: string;
  noise: string;
  noiseNote: string;
  unchanged: string;
  skipped: string;
  unstable: string;
  notIntended: string;
  added: string;
  notAdded: string;
  toast: (headline: string) => string;
  noRun: string;
  reviewProblem: {
    unreadable: (id: string) => string;
    version: (id: string) => string;
  };
  picturesOnDesktop: string;
  tooLarge: (path: string) => string;
  unreadable: (path: string) => string;
  commandShown: (id: string) => string;
  commandNoRun: string;
  alt: (kind: string, label: string, detail?: string) => string;
  draft: {
    intro: (id: string) => string;
    screen: (label: string) => string;
    conditions: (text: string) => string;
    areas: (text: string) => string;
    noAreas: string;
    pageSize: (text: string) => string;
    diff: (path: string) => string;
    after: (path: string) => string;
    ask: string;
  };
};

const screensEn = (count: number) =>
  `${count} ${count === 1 ? 'screen' : 'screens'}`;

const listEn = (items: readonly string[]) => {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
};

const size = (dimensions: readonly number[]) => dimensions.join('×');

export const STRINGS: Record<Lang, Strings> = {
  en: {
    before: 'Before',
    after: 'After',
    dark: 'dark',
    storybook: 'Storybook',
    run: (id) => `ui-compare · ${id}`,
    changedHeadline: (count) => `${screensEn(count)} changed`,
    failedHeadline: (count) => `${screensEn(count)} could not be captured`,
    unchangedHeadline: 'No screens changed',
    emptyHeadline: 'No screens were captured',
    failedCount: (count) => `${screensEn(count)} could not be captured`,
    noiseCount: (count) =>
      `${screensEn(count)} changed only where Before was unstable`,
    unchangedCount: (count) => `${screensEn(count)} unchanged`,
    skippedCount: (count) => `${screensEn(count)} skipped`,
    lead: (counts) => `${counts}.`,
    list: listEn,
    errorsHeading: 'Could not capture',
    phase: {
      before: 'Failed while capturing Before',
      after: 'Failed while capturing After',
    },
    sameChange: 'The same change appears in each of these.',
    pageSize: (before, after) => `Page size ${size(before)} → ${size(after)}`,
    warning: (message) => `Warning: ${message}`,
    area: (index, count) => `Area ${index} of ${count}`,
    fullPage: 'full page',
    viewFullPage: 'View full page',
    hideFullPage: 'Hide full page',
    showPage: 'Show page',
    hidePage: 'Hide page',
    pageHint: 'After. Point at it to see Before.',
    othersHeading: 'Other results',
    noise: 'Likely noise',
    noiseNote:
      'Changed only where the page already differed between two loads in Before.',
    unchanged: 'Unchanged',
    skipped: 'Skipped',
    unstable: 'Differences between the two Before loads',
    notIntended: 'Not intended',
    added: 'Added to your prompt',
    notAdded: 'Could not add to your prompt',
    toast: (headline) => `ui-compare: ${headline}. Open with /ui-compare-pane`,
    noRun: 'No ui-compare run to show yet.',
    reviewProblem: {
      unreadable: (id) => `The review of run ${id} could not be read.`,
      version: (id) =>
        `The review of run ${id} could not be read: a different version of ui-compare wrote it. Update the ui-compare plugin or CLI so they match.`,
    },
    picturesOnDesktop: 'Pictures are shown in Claude Code Desktop.',
    tooLarge: (path) => `Too large to draw here: ${path}`,
    unreadable: (path) => `Could not read ${path}`,
    commandShown: (id) => `Showing ui-compare run ${id} in the pane.`,
    commandNoRun:
      'No ui-compare run has a review yet. Run ui-compare after <id> first.',
    alt: (kind, label, detail) =>
      `${kind}: ${label}${detail ? `, ${detail}` : ''}`,
    draft: {
      intro: (id) => `ui-compare run ${id} shows a change I did not intend.`,
      screen: (label) => `Screen: ${label}`,
      conditions: (text) => `Conditions: ${text}`,
      areas: (text) => `Changed areas (page coordinates): ${text}`,
      noAreas: 'Changed areas: none, only the page size changed',
      pageSize: (text) => `Page size: ${text}`,
      diff: (path) => `Diff image: ${path}`,
      after: (path) => `After image: ${path}`,
      ask: 'Find what caused it and fix it.',
    },
  },
  ja: {
    before: '変更前',
    after: '変更後',
    dark: 'ダーク',
    storybook: 'Storybook',
    run: (id) => `ui-compare · ${id}`,
    changedHeadline: (count) => `${count} 画面が変わりました`,
    failedHeadline: (count) => `${count} 画面を撮影できませんでした`,
    unchangedHeadline: '変わった画面はありません',
    emptyHeadline: '撮影した画面はありません',
    failedCount: (count) => `撮影できなかった画面 ${count}`,
    noiseCount: (count) =>
      `変更前の時点で不安定だった箇所だけが変わった画面 ${count}`,
    unchangedCount: (count) => `変わらなかった画面 ${count}`,
    skippedCount: (count) => `スキップした画面 ${count}`,
    lead: (counts) => counts,
    list: (items) => items.join('、'),
    errorsHeading: '撮影できなかった画面',
    phase: { before: '変更前の撮影中に失敗', after: '変更後の撮影中に失敗' },
    sameChange: 'どの条件でも同じ変化です。',
    pageSize: (before, after) =>
      `ページの大きさ ${size(before)} → ${size(after)}`,
    warning: (message) => `警告：${message}`,
    area: (index, count) => `変化した箇所 ${index}/${count}`,
    fullPage: 'ページ全体',
    viewFullPage: 'ページ全体を見る',
    hideFullPage: 'ページ全体を閉じる',
    showPage: 'ページを見る',
    hidePage: 'ページを閉じる',
    pageHint: '変更後。ポインタを重ねると変更前を表示します。',
    othersHeading: 'そのほかの結果',
    noise: 'ノイズの可能性',
    noiseNote:
      '変更前に 2 回読み込んだ時点で既に差があった箇所だけが変わりました。',
    unchanged: '変化なし',
    skipped: 'スキップ',
    unstable: '変更前の 2 回の読み込みの差',
    notIntended: '意図していない',
    added: '入力欄に追加しました',
    notAdded: '入力欄に追加できませんでした',
    toast: (headline) => `ui-compare: ${headline}。/ui-compare-pane で開けます`,
    noRun: '表示できる ui-compare の結果はまだありません。',
    reviewProblem: {
      unreadable: (id) => `実行 ${id} の結果を読み込めませんでした。`,
      version: (id) =>
        `実行 ${id} の結果を読み込めませんでした。別のバージョンの ui-compare が書いた結果です。ui-compare のプラグインか CLI を更新してバージョンを揃えてください。`,
    },
    picturesOnDesktop: '画像は Claude Code Desktop で表示します。',
    tooLarge: (path) => `大きすぎて表示できません：${path}`,
    unreadable: (path) => `読み込めませんでした：${path}`,
    commandShown: (id) => `ui-compare の結果 ${id} をペインに表示しました。`,
    commandNoRun:
      'ui-compare の結果はまだありません。先に ui-compare after <id> を実行してください。',
    alt: (kind, label, detail) =>
      `${kind}：${label}${detail ? `（${detail}）` : ''}`,
    draft: {
      intro: (id) => `ui-compare の実行 ${id} に意図していない変化があります。`,
      screen: (label) => `画面：${label}`,
      conditions: (text) => `条件：${text}`,
      areas: (text) => `変化した箇所（ページ座標）：${text}`,
      noAreas: '変化した箇所：なし（ページの大きさだけが変わりました）',
      pageSize: (text) => `ページの大きさ：${text}`,
      diff: (path) => `差分画像：${path}`,
      after: (path) => `変更後の画像：${path}`,
      ask: '原因を調べて直してください。',
    },
  },
};

export function languageOf(setting: unknown): Lang {
  if (typeof setting !== 'string') return 'en';
  const value = setting.trim().toLowerCase();
  return value.startsWith('ja') || value === '日本語' ? 'ja' : 'en';
}
