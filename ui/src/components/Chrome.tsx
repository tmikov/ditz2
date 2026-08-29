/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Text } from 'ink';
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

export function Footer({ keys, width }: { keys: string; width: number }): React.ReactElement {
  return <Text dimColor wrap="truncate">{truncate(keys, width)}</Text>;
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
