/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, Text } from 'ink';
import React from 'react';
import type { Issue } from 'ditz2';
import { issueLines } from '../format.js';

/** The furthest `offset` that still shows something, given `rows` of room. */
export function maxIssueOffset(total: number, rows: number): number {
  if (total <= rows) return 0;
  return Math.max(total - Math.max(rows - 1, 1), 0);
}

export function IssueView(
  { issue, offset, rows, width }: { issue: Issue; offset: number; rows: number; width: number },
): React.ReactElement {
  const all = issueLines(issue, width);
  const room = all.length <= rows ? rows : Math.max(rows - 1, 1);
  const at = Math.min(Math.max(offset, 0), Math.max(all.length - room, 0));
  const shown = all.slice(at, at + room);
  const left = all.length - at - shown.length;

  return (
    <Box flexDirection="column">
      {shown.map((line, n) => (
        // eslint-disable-next-line react/no-array-index-key
        <Text key={n} wrap="truncate">{line === '' ? ' ' : line}</Text>
      ))}
      {Array.from({ length: Math.max(room - shown.length, 0) }, (_, n) => (
        // eslint-disable-next-line react/no-array-index-key
        <Text key={`pad-${n}`}> </Text>
      ))}
      {all.length > rows && (
        <Text dimColor wrap="truncate">
          {left > 0 ? `  ↓ ${left} more` : '  ↑ top of the issue is above'}
        </Text>
      )}
    </Box>
  );
}
