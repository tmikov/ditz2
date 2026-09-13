/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ditz2-ui` is an optional peer, not a dependency, so TypeScript cannot
 * resolve the literal specifier in ui.ts on a fresh clone: `ui/dist` does not
 * exist until ditz2 itself has been built, and without this declaration
 * ditz2's own typecheck would depend on a sibling workspace it does not
 * depend on. Measured — `npm run typecheck` fails with TS2307 when `ui/dist`
 * is absent and this file is not here.
 *
 * Declaring it untyped costs nothing. `handOverToUi` takes
 * `() => Promise<unknown>` and `isUiModule` narrows the result at run time, so
 * the module's types were never used even when they did resolve.
 */
declare module 'ditz2-ui';
