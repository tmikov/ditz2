/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, Text } from 'ink';
import React from 'react';
import type { Issue } from 'ditz2';
import { rowFor, windowOf } from '../format.js';

export interface IssueListProps {
  issues: Issue[];
  selectedId: string | null;
  rows: number;
  width: number;
}

export function IssueList({ issues, selectedId, rows, width }: IssueListProps): React.ReactElement {
  if (issues.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>no issues</Text>
      </Box>
    );
  }

  const selected = issues.findIndex((i) => i.id === selectedId);
  const { from, to } = windowOf(issues.length, selected, rows);

  return (
    <Box flexDirection="column">
      {issues.slice(from, to).map((issue) => (
        <Text
          key={issue.id}
          inverse={issue.id === selectedId}
          wrap="truncate"
        >
          {rowFor(issue, issue.id === selectedId, width)}
        </Text>
      ))}
    </Box>
  );
}
