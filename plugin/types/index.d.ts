export type UiCompareRun = { id: string; mtimeMs: number };

export type UiCompareView = {
  run: UiCompareRun | null;
  open: string[];
  drafted: string[];
};

declare module 'claude-code' {
  interface PluginState {
    'ui-compare': {
      view: Shaped<UiCompareView>;
      since: number;
    };
  }
}
