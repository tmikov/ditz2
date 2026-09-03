/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, Text } from 'ink';
import React from 'react';
import { shortId } from 'ditz2';
import type { Issue } from 'ditz2';
import { truncate } from '../format.js';
import { TextEntry } from './TextEntry.js';

export function CommentOverlay(
  { issue, lines, rows, width }:
  { issue: Issue; lines: string[]; rows: number; width: number },
): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate">
        {truncate(`comment on ${shortId(issue.id)}  ${issue.title}`, width)}
      </Text>
      <Text> </Text>
      <TextEntry lines={lines} rows={Math.max(rows - 2, 1)} width={width} />
    </Box>
  );
}
