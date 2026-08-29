/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Text } from 'ink';
import React from 'react';
import { truncate } from '../format.js';

export function FilterField(
  { query, width }: { query: string; width: number },
): React.ReactElement {
  return <Text wrap="truncate">{truncate(`/${query}█`, width)}</Text>;
}
