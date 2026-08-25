/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { v7 as uuidv7 } from 'uuid';
import { DzError } from './errors.js';
import type { IssueRef } from './types.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function newId(): string {
  return uuidv7();
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function resolvePrefix(prefix: string, refs: IssueRef[]): IssueRef {
  if (prefix === '') {
    throw new DzError(
      'NOT_FOUND',
      'an empty id prefix matches nothing; pass at least one character',
    );
  }
  const matches = refs.filter((ref) => ref.id.startsWith(prefix));
  if (matches.length === 0) {
    throw new DzError('NOT_FOUND', `no issue matches id prefix "${prefix}"`);
  }
  if (matches.length > 1) {
    const candidates = matches.map((m) => `  ${m.id}  ${m.title}`).join('\n');
    throw new DzError(
      'AMBIGUOUS_PREFIX',
      `id prefix "${prefix}" matches ${matches.length} issues:\n${candidates}`,
    );
  }
  return matches[0];
}
