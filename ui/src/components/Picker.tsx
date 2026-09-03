/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, Text } from 'ink';
import React from 'react';
import { truncate } from '../format.js';

/** Clamped, never wrapping: the ends of a short list should feel like ends. */
export function moveSelection(selected: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(selected + delta, 0), count - 1);
}

/**
 * One line per option, exactly one of them marked.
 *
 * `dim` is how the picker shows it does not have focus, so the operator can
 * see which of the two fields their next keystroke goes to.
 */
export function Picker(
  { options, selected, width, dim }:
  { options: readonly string[]; selected: number; width: number; dim?: boolean },
): React.ReactElement {
  return (
    <Box flexDirection="column">
      {options.map((option, n) => (
        <Text key={option} dimColor={dim === true} wrap="truncate">
          {truncate(`  ${n === selected ? '(*)' : '( )'} ${option}`, width)}
        </Text>
      ))}
    </Box>
  );
}
