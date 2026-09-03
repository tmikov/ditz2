/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, Text } from 'ink';
import React from 'react';
import { truncate } from '../format.js';

export function Header(
  { name, shown, total, query, width }:
  { name: string; shown: number; total: number; query: string; width: number },
): React.ReactElement {
  const filter = query.trim() === '' ? '' : `  filter: ${query}`;
  return (
    <Text bold wrap="truncate">
      {truncate(`ditz2 · ${name} · ${shown} of ${total}${filter}`, width)}
    </Text>
  );
}

/**
 * The rows a `<Footer>` occupies, whatever it has to say.
 *
 * The number App reserves for the footer in `CHROME_ROWS`, and the number
 * `<Footer>` draws. They must agree, so `app.tsx` imports this rather than
 * restating it.
 *
 * What the padding buys is a **stable footer position**: the last row of the
 * frame is the footer's last line on every screen that draws a `<Footer>`,
 * whether that footer has one entry or two. `footerOf` and every `at(-1)`
 * assertion in the suite rest on exactly that, and without it each of them
 * would have to know which screen it was looking at.
 *
 * It does NOT stop the body growing into a short footer, and no comment here
 * should say it does: `listRows` and `detailRows` come from `rows` and the
 * chrome constants alone, and nothing measures how tall the footer actually
 * drew. Nor is `FOOTER_ROWS` true of every screen — `/` replaces the footer
 * slot with `<FilterField>`, which is one unpadded `<Text>` and does not come
 * through here at all, so that frame is a row shorter than the reservation.
 * That is fine and deliberate, for the reason `listRows` already gives about
 * `<Notice>`: the reservation is an upper bound, and erring a row short wastes
 * a line while erring a row long makes Ink scroll the frame.
 *
 * Two, because ten list-screen bindings do not fit in eighty columns on one
 * line. The measurements are in plan 2c, task 2.
 */
export const FOOTER_ROWS = 2;

/**
 * One entry per line.
 *
 * Short footers are padded; long ones are NOT truncated. The no-truncation
 * half is the load-bearing one: a third line overflows the height App
 * reserved, and letting it draw is what makes the frame-height sweep report
 * it — silently dropping it would hide a binding instead. Verified by
 * breakage, not asserted: clamping to `FOOTER_ROWS` and adding a third entry
 * fails nothing in the suite.
 */
export function Footer(
  { keys, width }: { keys: readonly string[]; width: number },
): React.ReactElement {
  const shown = [...keys];
  while (shown.length < FOOTER_ROWS) shown.push('');
  return (
    <Box flexDirection="column">
      {shown.map((line, n) => (
        // Positional slots, not identified rows.
        // eslint-disable-next-line react/no-array-index-key
        <Text key={n} dimColor wrap="truncate">{truncate(line, width) || ' '}</Text>
      ))}
    </Box>
  );
}

/**
 * The one status line. An error outranks a notice: a filter the operator typed
 * that ditz2 rejected is the thing they are waiting to hear about.
 */
export function Notice(
  { text, error, unreadable, width }:
  { text: string | null; error: string | null; unreadable: number; width: number },
): React.ReactElement | null {
  const parts = [
    error === null ? null : `filter: ${error}`,
    text,
    unreadable === 0 ? null : `${unreadable} unreadable file${unreadable === 1 ? '' : 's'}`,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  return (
    <Text color={error === null ? undefined : 'red'} wrap="truncate">
      {truncate(parts.join('  ·  '), width)}
    </Text>
  );
}
