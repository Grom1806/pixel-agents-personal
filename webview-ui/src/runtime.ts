/**
 * Runtime detection, provider-agnostic
 *
 * Single source of truth for determining whether the webview is running
 * inside an IDE extension (VS Code, Cursor, Windsurf, etc.) or standalone
 * in a browser.
 */

declare global {
  interface Window {
    pixelAgentsDesktop?: {
      chooseProjectFolder: () => Promise<string | null>;
    };
  }
}

type Runtime = 'vscode' | 'desktop' | 'browser';

const runtime: Runtime =
  typeof (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi !== 'undefined'
    ? 'vscode'
    : window.pixelAgentsDesktop
      ? 'desktop'
      : 'browser';

export const isBrowserRuntime = runtime === 'browser';
export const isDesktopRuntime = runtime === 'desktop';
export const isStandaloneRuntime = runtime !== 'vscode';

/**
 * True only under the Playwright e2e harness, which sets `__PIXEL_AGENTS_E2E`
 * via `addInitScript` before any app code runs (so it's set in every frame,
 * including the VS Code webview iframe). Gates test-only diagnostics
 * (window.__pixelAgentsTestHooks message/sound logs, the addAgent wrapper) so
 * they never run, and never grow unbounded, in a real user's session.
 */
export const isE2E: boolean =
  typeof window !== 'undefined' &&
  (window as unknown as { __PIXEL_AGENTS_E2E?: boolean }).__PIXEL_AGENTS_E2E === true;
