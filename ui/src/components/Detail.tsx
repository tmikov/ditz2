/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, Text } from 'ink';
import React from 'react';
import type { Issue } from 'ditz2';
import { detailLines } from '../format.js';

export function Detail(
  { issue, rows, width }: { issue: Issue | null; rows: number; width: number },
): React.ReactElement {
  // Sliced on both branches, so the pane is exactly `rows` lines whichever
  // one runs. detailLines already guarantees that for itself; without the
  // slice here the empty branch would be the one place the guarantee lapses.
  const body = (issue === null
    ? ['nothing selected', ...Array.from({ length: Math.max(rows - 1, 0) }, () => '')]
    : detailLines(issue, rows, width)).slice(0, Math.max(rows, 0));

  return (
    <Box flexDirection="column" borderStyle="single" borderBottom={false}
      borderLeft={false} borderRight={false}>
      {body.map((line, n) => (
        // The index is a legitimate key here: these are positional slots in a
        // fixed-height pane, not identified rows, and slot n is always slot n.
        // eslint-disable-next-line react/no-array-index-key
        <Text key={n} wrap="truncate" dimColor={n > 1}>{line === '' ? ' ' : line}</Text>
      ))}
    </Box>
  );
}
