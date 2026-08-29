/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, Text } from 'ink';
import React from 'react';

const HELP: readonly (readonly [string, string])[] = [
  ['up / down, j / k', 'move'],
  ['Home / End, g / G', 'first / last'],
  ['PgUp / PgDn, ^U / ^D', 'page'],
  ['/', 'filter; enter keeps it, esc clears it'],
  ['r', 'reload from disk'],
  ['?', 'this list; up/down scrolls it'],
  ['q', 'quit'],
  ['enter', 'open the selected issue full-screen'],
  ['enter / esc / q, in the issue view', 'back to the list — q does not quit'],
  ['', ''],
  ['in the filter field', 'bare words are a regex over titles, bodies and log'],
  ['status:open', 'also in-progress, closed'],
  ['type:bug', 'also feature, task'],
  ['component:cli', 'as configured in dz/config.yaml'],
  ['assignee:me', 'you, as dz records you'],
  ['all:true', 'include closed issues'],
];

/** How many lines the bindings occupy. App needs it to bound scrolling. */
export const HELP_LINES = HELP.length;

/** The furthest `offset` that still shows something, given `rows` of room. */
export function maxHelpOffset(rows: number): number {
  return Math.max(HELP_LINES - Math.max(rows - 1, 1), 0);
}

/**
 * Takes a row budget, stays inside it, and scrolls.
 *
 * No border, and it replaces the list and the detail pane together rather than
 * just the pane: the bindings are 14 lines and a short terminal's detail pane
 * is far fewer, so an overlay sized to the pane would push the header and
 * footer off the screen.
 *
 * Scrolling rather than only marking the overflow. A "… 5 more" that nothing
 * can reveal tells the operator that five bindings exist and refuses to name
 * them, which is a worse answer than a longer scroll.
 */
export function HelpOverlay(
  { rows, offset, width }: { rows: number; offset: number; width: number },
): React.ReactElement {
  const all = HELP.map(([key, what]) => (key === '' ? '' : `  ${key.padEnd(22)}${what}`));

  if (all.length <= rows) {
    return (
      <Box flexDirection="column" width={Math.min(width, 72)}>
        {all.map((line, n) => (
          // eslint-disable-next-line react/no-array-index-key
          <Text key={n} wrap="truncate">{line === '' ? ' ' : line}</Text>
        ))}
      </Box>
    );
  }

  // One row goes to the scroll indicator, which is also where the remaining
  // count lives.
  const room = Math.max(rows - 1, 1);
  const at = Math.min(Math.max(offset, 0), Math.max(all.length - room, 0));
  const shown = all.slice(at, at + room);
  const left = all.length - at - shown.length;

  return (
    <Box flexDirection="column" width={Math.min(width, 72)}>
      {shown.map((line, n) => (
        // eslint-disable-next-line react/no-array-index-key
        <Text key={n} wrap="truncate">{line === '' ? ' ' : line}</Text>
      ))}
      <Text dimColor wrap="truncate">
        {left > 0 ? `  ↓ ${left} more — up/down to scroll` : '  ↑ up to scroll back'}
      </Text>
    </Box>
  );
}
