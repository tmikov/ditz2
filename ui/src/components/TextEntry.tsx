/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, Text } from 'ink';
import type { Key } from 'ink';
import React from 'react';
import { truncate } from '../format.js';

/** Appends one printable character to the last line. */
export function append(lines: string[], input: string): string[] {
  const out = [...lines];
  out[out.length - 1] = (out[out.length - 1] ?? '') + input;
  return out;
}

/**
 * Deletes one character, joining lines when the current one is empty.
 *
 * Without the join, backspace stalls at the start of a line and the operator
 * cannot undo a newline they just typed.
 */
export function backspace(lines: string[]): string[] {
  const out = [...lines];
  const last = out[out.length - 1] ?? '';
  if (last !== '') {
    out[out.length - 1] = last.slice(0, -1);
    return out;
  }
  if (out.length === 1) return out;
  out.pop();
  return out;
}

/**
 * The whole keyboard contract of a text entry, as new lines or null.
 *
 * Null means the key is not this entry's, so the caller can go on to its own
 * bindings. Every overlay with a text field routes through here rather than
 * spelling the three cases out again: the comment overlay and the close
 * overlay's comment field are the same editor, and two copies of "Enter is a
 * newline, not a save" would be free to disagree.
 *
 * Control characters are not text — without that guard a stray ^C or an
 * unhandled escape sequence lands in the entry as garbage.
 */
export function handleEntryKey(
  lines: string[], input: string, key: Key, multiline = true,
): string[] | null {
  if (key.return) return multiline ? [...lines, ''] : null;
  if (key.backspace || key.delete) return backspace(lines);
  if (input !== '' && !key.ctrl && !key.meta) return append(lines, input);
  return null;
}

/**
 * The same editor, for a field that is one line.
 *
 * The rule lives in the flag rather than in a second handler beside this one:
 * a form field and the comment overlay have to agree about what a control
 * character is, and two copies would be free to disagree.
 *
 * Joined rather than taking the first line. With `multiline` false the array
 * is always one element, so the join is the identity — and a caller that ever
 * flips the flag gets a visible newline instead of a silently dropped one.
 */
export function handleLineKey(value: string, input: string, key: Key): string | null {
  const edited = handleEntryKey([value], input, key, false);
  return edited === null ? null : edited.join('\n');
}

/** The last `width` characters, for a line whose end must stay visible. */
function tailOf(line: string, width: number): string {
  return line.length <= width ? line : line.slice(line.length - width);
}

export function TextEntry(
  { lines, rows, width }: { lines: string[]; rows: number; width: number },
): React.ReactElement {
  // The cursor is on the last line, so keep the END of the text when it
  // overflows: scrolling the cursor off the screen is the one thing a text
  // entry must never do.
  const shown = lines.slice(Math.max(lines.length - rows, 0));
  return (
    <Box flexDirection="column">
      {shown.map((line, n) => {
        const isLast = n === shown.length - 1;
        // Horizontally as well as vertically, and for the same reason.
        // Nothing here wraps: `handleEntryKey` starts a new line only on
        // Enter and this <Text> clips rather than folds, so a comment typed
        // past the frame overflows sideways exactly as a title longer than
        // its column does. `truncate` keeps the head, which puts an ellipsis
        // where the cursor should be and makes every further keystroke
        // invisible. One column of the budget is the cursor's.
        const text = isLast ? `${tailOf(line, width - 1)}█` : line;
        return (
          // Positional slots, not identified rows.
          // eslint-disable-next-line react/no-array-index-key
          <Text key={n} wrap="truncate">{truncate(text, width) || ' '}</Text>
        );
      })}
    </Box>
  );
}
