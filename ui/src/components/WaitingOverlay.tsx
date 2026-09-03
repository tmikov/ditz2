/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, Text } from 'ink';
import React from 'react';
import type { LockInfo } from 'ditz2';
import { truncate } from '../format.js';

/**
 * Who holds the lock, in prose.
 *
 * Never interpolates a field that might be absent: a lock file this build
 * cannot parse yields `holder: null`, and "held by undefined (pid undefined)"
 * is worse than admitting the file is unreadable.
 */
export function holderLine(holder: LockInfo | null): string {
  if (holder === null) return 'held by a process this lock file does not describe';
  return `held by ${holder.command} (pid ${holder.pid}) on ${holder.hostname}`;
}

/**
 * Whole seconds, floored, so the display never reads "0.4s".
 *
 * Clamped at zero as well: a clock corrected backwards under the running
 * process would otherwise count down, and "waiting -3s" reads as a bug in the
 * tool rather than as a bug in the clock.
 */
export function elapsedLine(since: number, now: number): string {
  const seconds = Math.max(Math.floor((now - since) / 1000), 0);
  return `waiting ${seconds}s`;
}

export function WaitingOverlay(
  { op, holder, since, attempts, now, width }:
  {
    op: string; holder: LockInfo | null; since: number;
    attempts: number; now: number; width: number;
  },
): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate">{truncate(`waiting for the lock to run ${op}`, width)}</Text>
      <Text wrap="truncate">{truncate(`  ${holderLine(holder)}`, width)}</Text>
      <Text dimColor wrap="truncate">
        {truncate(`  ${elapsedLine(since, now)}, ${attempts} attempt${attempts === 1 ? '' : 's'}`, width)}
      </Text>
    </Box>
  );
}
