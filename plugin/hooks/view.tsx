import type { Elements, RenderElement } from 'claude-code';

import type {
  Box as Area,
  ReviewChange,
  ReviewCrop,
  ReviewError,
  ReviewFile,
  ReviewPage,
  ReviewScreen,
  StripImage,
} from './review-file';
import type { Strings } from './strings';
import {
  changeKey,
  changeNotes,
  otherNote,
  others,
  overview,
  runPath,
  timesLine,
  variantsText,
} from './summary';
import type { Other } from './summary';
import { frameOf, stripDrawings } from './svg';
import type { Size } from './svg';

type Desktop = Elements['desktop'];
type Plain = Pick<Elements['terminal'], 'Box' | 'Text'>;

export type PaneView = {
  review: ReviewFile;
  t: Strings;
  open: ReadonlySet<string>;
  drafted: ReadonlySet<string>;
  base64Of: (file: string) => string | undefined;
  toggle: (key: string) => Promise<unknown>;
  draft: (
    screen: ReviewScreen,
    change: ReviewChange,
    key: string,
  ) => Promise<unknown>;
};

const KIND_COLORS = {
  noise: 'warning',
  unchanged: 'success',
  skipped: 'subtle',
} as const;

export function pageKey(key: string): string {
  return `page:${key}`;
}

function hasPicture(page: ReviewPage | undefined): page is ReviewPage {
  return (
    page?.before !== undefined ||
    page?.after !== undefined ||
    page?.unstable !== undefined
  );
}

function pageFiles(page: ReviewPage): string[] {
  return [page.after, page.before, page.unstable].flatMap(
    (image) => image?.strips.map(({ file }) => file) ?? [],
  );
}

export function shownFiles(
  review: ReviewFile,
  open: ReadonlySet<string>,
): string[] {
  const files = review.changed.flatMap(({ changes }, screen) =>
    changes.flatMap((change, index) => {
      const crops = change.crops.flatMap(({ before, after }) =>
        [...before.strips, ...after.strips].map(({ file }) => file),
      );
      const isPageShown =
        change.fullPage || open.has(pageKey(changeKey(screen, index)));
      return isPageShown ? [...crops, ...pageFiles(change.page)] : crops;
    }),
  );
  const lines = others(review).flatMap(({ key, entry }) =>
    open.has(pageKey(key)) && entry.page ? pageFiles(entry.page) : [],
  );
  return [...new Set([...files, ...lines])];
}

export function plainPane(
  { Box, Text }: Plain,
  lines: readonly string[],
): RenderElement {
  return (
    <Box flexDirection="column">
      {lines.map((line) => (
        <Text>{line === '' ? ' ' : line}</Text>
      ))}
    </Box>
  );
}

export function headerOf(
  { Box, Text }: Plain,
  review: ReviewFile,
  t: Strings,
): RenderElement {
  const { headline, lead } = overview(review, t);
  return (
    <Box flexDirection="column" gap="xs">
      <Text dimColor size="footnote" tabular>
        {timesLine(review, t)}
      </Text>
      <Text size="title" weight="bold">
        {headline}
      </Text>
      {lead !== undefined && <Text dimColor>{lead}</Text>}
    </Box>
  );
}

export function desktopPane(els: Desktop, view: PaneView): RenderElement {
  const { Box, Text } = els;
  const { review, t } = view;
  const lines = others(review);
  return (
    <Box flexDirection="column" gap="lg">
      {headerOf(els, review, t)}
      {review.errors.length > 0 && (
        <Box flexDirection="column" gap="sm">
          <Text size="heading" weight="bold" color="error">
            {t.errorsHeading}
          </Text>
          {review.errors.map((entry) => errorBlock(els, entry, t))}
        </Box>
      )}
      {review.changed.map((screen, index) => card(els, view, screen, index))}
      {lines.length > 0 && (
        <Box flexDirection="column" gap="sm" borderStyle="round" padding="md">
          <Text size="heading" weight="bold">
            {t.othersHeading}
          </Text>
          {lines.map((line) => otherLine(els, view, line))}
        </Box>
      )}
    </Box>
  );
}

function errorBlock(
  { Box, Text }: Desktop,
  entry: ReviewError,
  t: Strings,
): RenderElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="error"
      padding="sm"
    >
      <Box flexDirection="row" flexWrap="wrap" columnGap="sm">
        <Text weight="bold">{entry.screen.label}</Text>
        <Text dimColor size="footnote">
          {variantsText(entry.variants, t)}
        </Text>
      </Box>
      <Text color="error" size="footnote">
        {t.phase[entry.phase]}
      </Text>
      <Text mono size="footnote">
        {entry.message}
      </Text>
    </Box>
  );
}

function card(
  els: Desktop,
  view: PaneView,
  screen: ReviewScreen,
  index: number,
): RenderElement {
  const { Box, Text } = els;
  const { t } = view;
  return (
    <Box flexDirection="column" gap="md" borderStyle="round" padding="md">
      <Box flexDirection="row" flexWrap="wrap" gap="sm" alignItems="center">
        <Text size="heading" weight="bold">
          {screen.screen.label}
        </Text>
        {screen.screen.kind === 'component' && (
          <Text size="caption" color="suggestion">
            {t.storybook}
          </Text>
        )}
      </Box>
      {screen.changes.map((change, changeIndex) =>
        changeBlock(els, view, screen, change, changeKey(index, changeIndex)),
      )}
    </Box>
  );
}

function changeBlock(
  els: Desktop,
  view: PaneView,
  screen: ReviewScreen,
  change: ReviewChange,
  key: string,
): RenderElement {
  const { Box, Button, Text } = els;
  const { t } = view;
  const isPageOpen = view.open.has(pageKey(key));
  const { label } = screen.screen;
  return (
    <Box flexDirection="column" gap="sm">
      <Text weight="bold" tabular>
        {variantsText(change.variants, t)}
      </Text>
      {changeNotes(change, t).map(({ text, isWarning }) =>
        isWarning ? (
          <Text color="warning" size="footnote">
            {text}
          </Text>
        ) : (
          <Text dimColor size="footnote">
            {text}
          </Text>
        ),
      )}
      {change.fullPage
        ? pageView(els, view, change.page, label, key)
        : change.crops.map((crop, index, all) =>
            cropView(
              els,
              view,
              crop,
              label,
              all.length === 1 ? undefined : t.area(index + 1, all.length),
            ),
          )}
      <Box flexDirection="row" flexWrap="wrap" gap="sm" alignItems="center">
        {!change.fullPage && (
          <Button
            key={pageKey(key)}
            label={isPageOpen ? t.close : t.viewFullPage}
            onPress={() => view.toggle(pageKey(key))}
          />
        )}
        {view.drafted.has(key) ? (
          <Text color="success">{t.added}</Text>
        ) : (
          <Button
            key={`draft:${key}`}
            label={t.notIntended}
            onPress={() => view.draft(screen, change, key)}
          />
        )}
      </Box>
      {!change.fullPage &&
        isPageOpen &&
        pageView(els, view, change.page, label, key)}
    </Box>
  );
}

function cropView(
  els: Desktop,
  view: PaneView,
  crop: ReviewCrop,
  label: string,
  area: string | undefined,
): RenderElement {
  const { Box, Text } = els;
  const { t } = view;
  const frame = frameOf(crop.before, crop.after);
  const mark = {
    x: crop.area.x - crop.box.x,
    y: crop.area.y - crop.box.y,
    width: crop.area.width,
    height: crop.area.height,
  };
  return (
    <Box flexDirection="column" gap="xs">
      {area !== undefined && (
        <Text dimColor size="caption">
          {area}
        </Text>
      )}
      <Text dimColor size="footnote">
        {t.before}
      </Text>
      {strips(
        els,
        view,
        crop.before,
        frame,
        [mark],
        t.alt(t.before, label, area),
      )}
      <Text dimColor size="footnote">
        {t.after}
      </Text>
      {strips(
        els,
        view,
        crop.after,
        frame,
        [mark],
        t.alt(t.after, label, area),
      )}
    </Box>
  );
}

function pageView(
  els: Desktop,
  view: PaneView,
  page: ReviewPage,
  label: string,
  key: string,
): RenderElement {
  const { Box, Text } = els;
  const { t } = view;
  const { before, after, unstable, marks } = page;
  const frame = frameOf(before, after);
  const detail = t.fullPage;
  const single =
    after === undefined
      ? before === undefined
        ? undefined
        : { image: before, kind: t.before }
      : { image: after, kind: t.after };
  return (
    <Box flexDirection="column" gap="xs">
      {after !== undefined && before !== undefined ? (
        <Box flexDirection="column" gap="xs">
          <Text dimColor size="footnote">
            {t.pageHint}
          </Text>
          <Box key={`swap:${key}`} position="relative" flexDirection="column">
            {strips(
              els,
              view,
              after,
              frame,
              marks,
              t.alt(t.after, label, detail),
            )}
            <Box
              position="absolute"
              top={0}
              left={0}
              display="none"
              hover={{ display: 'flex' }}
              flexDirection="column"
            >
              {strips(
                els,
                view,
                before,
                frame,
                marks,
                t.alt(t.before, label, detail),
              )}
            </Box>
          </Box>
        </Box>
      ) : (
        single !== undefined && (
          <Box flexDirection="column" gap="xs">
            <Text dimColor size="footnote">
              {single.kind}
            </Text>
            {strips(
              els,
              view,
              single.image,
              frame,
              marks,
              t.alt(single.kind, label, detail),
            )}
          </Box>
        )
      )}
      {unstable !== undefined && (
        <Box flexDirection="column" gap="xs">
          <Text dimColor size="footnote">
            {t.unstable}
          </Text>
          {strips(
            els,
            view,
            unstable,
            frameOf(unstable),
            [],
            t.alt(t.unstable, label),
          )}
        </Box>
      )}
    </Box>
  );
}

function strips(
  { Box, Svg, Text }: Desktop,
  view: PaneView,
  image: StripImage,
  frame: Size,
  marks: readonly Area[],
  alt: string,
): RenderElement {
  const { review, t } = view;
  return (
    <Box flexDirection="column">
      {stripDrawings(image, frame, marks, view.base64Of).map((drawing) =>
        'source' in drawing ? (
          <Svg source={drawing.source} alt={alt} />
        ) : (
          <Text dimColor size="footnote">
            {(drawing.problem === 'too-large' ? t.tooLarge : t.unreadable)(
              runPath(review.id, drawing.file),
            )}
          </Text>
        ),
      )}
    </Box>
  );
}

function otherLine(els: Desktop, view: PaneView, line: Other): RenderElement {
  const { Box, Button, Text } = els;
  const { t } = view;
  const { entry, key, kind } = line;
  const { page } = entry;
  const isOpen = view.open.has(pageKey(key));
  return (
    <Box flexDirection="column" gap="xs">
      <Box flexDirection="row" flexWrap="wrap" gap="sm" alignItems="center">
        <Text weight="medium">{entry.screen.label}</Text>
        <Text dimColor size="footnote">
          {variantsText(entry.variants, t)}
        </Text>
        {hasPicture(page) && (
          <Button
            key={pageKey(key)}
            label={isOpen ? t.close : t.viewFullPage}
            onPress={() => view.toggle(pageKey(key))}
          />
        )}
      </Box>
      <Text size="footnote" color={KIND_COLORS[kind]}>
        {otherNote(line, t)}
      </Text>
      {isOpen &&
        hasPicture(page) &&
        pageView(els, view, page, entry.screen.label, key)}
    </Box>
  );
}
