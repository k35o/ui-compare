export type Lang = 'en' | 'ja';

export type ViewportSize = { width: number; height?: number };

type Pair = readonly [width: number, height: number];

export type Strings = {
  before: string;
  after: string;
  storybook: string;
  changedHeadline: (names: readonly string[]) => string;
  failedHeadline: (names: readonly string[]) => string;
  unchangedHeadline: string;
  emptyHeadline: string;
  counts: {
    failed: (count: number) => string;
    noise: (count: number) => string;
    unchanged: (count: number) => string;
    skipped: (count: number) => string;
  };
  lead: (counts: readonly string[], followsNames: boolean) => string;
  date: (month: number, day: number) => string;
  sizes: (sizes: readonly ViewportSize[]) => string;
  darkMode: string;
  lightAndDarkMode: string;
  setting: (parts: readonly string[]) => string;
  stories: (stories: readonly string[], setting: string) => string;
  withScheme: (size: string, scheme: string) => string;
  eachOf: (variants: readonly string[]) => string;
  named: (label: string, target: string, kind: 'url' | 'component') => string;
  errorsHeading: string;
  phase: { before: string; after: string };
  failure: (phase: string, message: string) => string;
  sameChange: (count: number) => string;
  pageSize: (before: Pair, after: Pair) => string;
  warning: (message: string) => string;
  area: (index: number, count: number) => string;
  fullPage: string;
  viewFullPage: string;
  close: string;
  pageHint: string;
  othersHeading: string;
  noise: string;
  unchanged: string;
  skipped: (reason: string | undefined) => string;
  unstable: string;
  notIntended: string;
  added: string;
  notAdded: string;
  openPane: string;
  dismiss: string;
  noRun: string;
  resultProblem: { unreadable: string; version: string };
  picturesOnDesktop: string;
  tooLarge: (path: string) => string;
  unreadable: (path: string) => string;
  commandShown: string;
  alt: (kind: string, label: string, detail?: string) => string;
  draft: {
    intro: (id: string) => string;
    changed: (name: string) => string;
    seenAt: (variants: string) => string;
    areas: (text: string) => string;
    noAreas: string;
    diff: (path: string) => string;
    after: (path: string) => string;
    ask: string;
  };
};

const NAMES_SHOWN = 3;

const listEn = (items: readonly string[]) =>
  items.length <= 2
    ? items.join(' and ')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

const listJa = (items: readonly string[]) =>
  items.join(items.length <= 2 ? ' と ' : '、');

const namesEn = (names: readonly string[]) =>
  names.length <= NAMES_SHOWN
    ? listEn(names)
    : `${names.slice(0, NAMES_SHOWN).join(', ')} and ${names.length - NAMES_SHOWN} more`;

const namesJa = (names: readonly string[]) => {
  const quoted = names.slice(0, NAMES_SHOWN).map((name) => `「${name}」`);
  if (names.length === 2) return quoted.join('と');
  const rest = names.length - NAMES_SHOWN;
  return rest > 0 ? `${quoted.join('')}ほか ${rest} 件` : quoted.join('');
};

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const isWidthOnly = (sizes: readonly ViewportSize[]) =>
  sizes.every(({ height }) => height === undefined);

const dimensions = ({ width, height }: ViewportSize) => `${width}×${height}`;

export const STRINGS: Record<Lang, Strings> = {
  en: {
    before: 'Before',
    after: 'After',
    storybook: 'Storybook',
    changedHeadline: (names) => `${namesEn(names)} changed`,
    failedHeadline: (names) => `${namesEn(names)} could not be captured`,
    unchangedHeadline: 'Nothing looks different',
    emptyHeadline: 'Nothing was captured',
    counts: {
      failed: (count) => `${count} not captured`,
      noise: (count) =>
        count === 1
          ? '1 changed only where it changes on every load'
          : `${count} changed only where they change on every load`,
      unchanged: (count) => `${count} unchanged`,
      skipped: (count) => `${count} left out`,
    },
    lead: (counts, followsNames) =>
      `${followsNames ? 'Also ' : ''}${listEn(counts)}.`,
    date: (month, day) => `${MONTHS[month - 1]} ${day}`,
    sizes: (sizes) =>
      isWidthOnly(sizes)
        ? `${listEn(sizes.map(({ width }) => `${width}px`))} wide`
        : listEn(
            sizes.map((size) =>
              size.height === undefined
                ? `${size.width}px wide`
                : dimensions(size),
            ),
          ),
    darkMode: 'dark mode',
    lightAndDarkMode: 'light and dark mode',
    setting: (parts) => parts.join(', '),
    stories: (stories, setting) => `${listEn(stories)} (${setting})`,
    withScheme: (size, scheme) => `${size} (${scheme})`,
    eachOf: listEn,
    named: (label, target, kind) =>
      kind === 'component'
        ? `${label} (Storybook component ${target})`
        : `${label} (${target})`,
    errorsHeading: 'Not captured',
    phase: {
      before: 'Failed while capturing Before',
      after: 'Failed while capturing After',
    },
    failure: (phase, message) => `${phase}: ${message}`,
    sameChange: (count) =>
      count === 2
        ? 'Both changed the same way.'
        : 'They all changed the same way.',
    pageSize: ([beforeWidth, beforeHeight], [afterWidth, afterHeight]) =>
      beforeWidth === afterWidth
        ? `The page height changed from ${beforeHeight}px to ${afterHeight}px.`
        : `The page size changed from ${beforeWidth}×${beforeHeight} to ${afterWidth}×${afterHeight}.`,
    warning: (message) => `Note: ${message}`,
    area: (index, count) => `Spot ${index} of ${count}`,
    fullPage: 'full page',
    viewFullPage: 'View full page',
    close: 'Close',
    pageHint: 'This is After. Point at it to see Before.',
    othersHeading: 'Others',
    noise: 'Only parts that change on every load (like a clock) changed',
    unchanged: 'Unchanged',
    skipped: (reason) =>
      reason === undefined ? 'Left out' : `Left out: ${reason}`,
    unstable: 'Difference between the two Before loads',
    notIntended: 'Not intended',
    added: 'Added to your message. Send it to have it fixed.',
    notAdded: 'Could not add it to your message.',
    openPane: 'Open',
    dismiss: 'Dismiss',
    noRun: 'No ui-compare result to show yet.',
    resultProblem: {
      unreadable: 'Could not read the ui-compare result.',
      version:
        'Could not read the ui-compare result: a different version of ui-compare wrote it. Update the ui-compare plugin or CLI so they match.',
    },
    picturesOnDesktop: 'Pictures are shown in Claude Code Desktop.',
    tooLarge: (path) => `Too large to draw here: ${path}`,
    unreadable: (path) => `Could not read ${path}`,
    commandShown: 'Showing the latest ui-compare result in the pane.',
    alt: (kind, label, detail) =>
      `${kind}: ${label}${detail ? `, ${detail}` : ''}`,
    draft: {
      intro: (id) => `ui-compare run ${id} shows a change I did not intend.`,
      changed: (name) => `What changed: ${name}`,
      seenAt: (variants) => `Seen at: ${variants}`,
      areas: (text) => `Changed spots (page coordinates): ${text}`,
      noAreas: 'Changed spots: none, only the page size changed',
      diff: (path) => `Image with the changed pixels in red: ${path}`,
      after: (path) => `After image: ${path}`,
      ask: 'Find what caused it and fix it.',
    },
  },
  ja: {
    before: '変更前',
    after: '変更後',
    storybook: 'Storybook',
    changedHeadline: (names) => `${namesJa(names)}の見た目が変わりました`,
    failedHeadline: (names) => `${namesJa(names)}を撮影できませんでした`,
    unchangedHeadline: '見た目は変わっていません',
    emptyHeadline: '撮影したものはありません',
    counts: {
      failed: (count) => `撮影できなかったもの ${count} 件`,
      noise: (count) => `毎回変わる部分だけが変わったもの ${count} 件`,
      unchanged: (count) => `変わらなかったもの ${count} 件`,
      skipped: (count) => `撮影しなかったもの ${count} 件`,
    },
    lead: (counts, followsNames) =>
      `${followsNames ? 'ほかに、' : ''}${counts.join('、')}があります`,
    date: (month, day) => `${month}月${day}日`,
    sizes: (sizes) =>
      isWidthOnly(sizes)
        ? `幅 ${listJa(sizes.map(({ width }) => `${width}px`))}`
        : listJa(
            sizes.map((size) =>
              size.height === undefined
                ? `幅 ${size.width}px`
                : dimensions(size),
            ),
          ),
    darkMode: 'ダークモード',
    lightAndDarkMode: 'ライトモードとダークモード',
    setting: (parts) => parts.join('、'),
    stories: (stories, setting) => `${listJa(stories)}（${setting}）`,
    withScheme: (size, scheme) => `${size}（${scheme}）`,
    eachOf: (variants) => variants.join('、'),
    named: (label, target, kind) =>
      kind === 'component'
        ? `「${label}」（Storybook のコンポーネント ${target}）`
        : `「${label}」（${target}）`,
    errorsHeading: '撮影できなかったもの',
    phase: { before: '変更前の撮影で失敗', after: '変更後の撮影で失敗' },
    failure: (phase, message) => `${phase}：${message}`,
    sameChange: (count) =>
      count === 2 ? 'どちらも同じ変わり方です' : 'どれも同じ変わり方です',
    pageSize: ([beforeWidth, beforeHeight], [afterWidth, afterHeight]) =>
      beforeWidth === afterWidth
        ? `ページの高さが ${beforeHeight}px から ${afterHeight}px に変わりました`
        : `ページの大きさが ${beforeWidth}×${beforeHeight} から ${afterWidth}×${afterHeight} に変わりました`,
    warning: (message) => `注意：${message}`,
    area: (index, count) => `${index} か所目（全 ${count} か所）`,
    fullPage: 'ページ全体',
    viewFullPage: 'ページ全体を見る',
    close: '閉じる',
    pageHint: '変更後のページです。ポインタを重ねると変更前に切り替わります',
    othersHeading: 'そのほか',
    noise: 'もともと毎回変わる部分（時計など）だけが変わりました',
    unchanged: '変わっていません',
    skipped: (reason) =>
      reason === undefined
        ? '撮影しませんでした'
        : `撮影しませんでした：${reason}`,
    unstable: '変更前に 2 回読み込んだときの違い',
    notIntended: '意図していない',
    added: '入力欄に書きました。送ると直してもらえます',
    notAdded: '入力欄に書けませんでした',
    openPane: '開く',
    dismiss: '閉じる',
    noRun: '表示できる ui-compare の結果はまだありません。',
    resultProblem: {
      unreadable: 'ui-compare の結果を読み込めませんでした。',
      version:
        'ui-compare の結果を読み込めませんでした。別のバージョンの ui-compare が書いた結果です。ui-compare のプラグインか CLI を更新してバージョンを揃えてください。',
    },
    picturesOnDesktop: '画像は Claude Code Desktop で表示します。',
    tooLarge: (path) => `大きすぎて表示できません：${path}`,
    unreadable: (path) => `読み込めませんでした：${path}`,
    commandShown: '最新の ui-compare の結果をペインに表示しました。',
    alt: (kind, label, detail) =>
      `${kind}：${label}${detail ? `、${detail}` : ''}`,
    draft: {
      intro: (id) => `ui-compare の実行 ${id} に意図していない変化があります。`,
      changed: (name) => `変わったもの：${name}`,
      seenAt: (variants) => `表示：${variants}`,
      areas: (text) => `変わった場所（ページ上の座標）：${text}`,
      noAreas: '変わった場所：なし（ページの大きさだけが変わりました）',
      diff: (path) => `変わったピクセルを赤で示した画像：${path}`,
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
