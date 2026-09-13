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

/**
 * How much of an id the tool prints.
 *
 * A UUIDv7's leading 48 bits are the millisecond it was minted in, and that is
 * exactly the first 13 characters: both of the first two dash-delimited groups
 * and the dash between them. Nothing that distinguishes two ids minted in the
 * same millisecond lives in there. Nor is it a matter of taking a few more
 * characters: uuid@11 implements v7 monotonicity by drawing its counter once
 * per millisecond and then incrementing it, so two consecutive ids can agree
 * on 25 of their 36 characters and a prefix that always told them apart would
 * need 26 — the whole id, near enough.
 *
 * So the length is not what makes a short id unique. `newId` is: it will not
 * mint an id whose first 13 characters are already spoken for, which is what
 * lets this prefix be a name a user can paste back rather than a hope.
 */
const SHORT_ID_LEN = 13;

/**
 * The abbreviation every command prints, and `resolvePrefix` is what accepts
 * it back. The two are one rule and live together on purpose.
 */
export function shortId(id: string): string {
  return id.slice(0, SHORT_ID_LEN);
}

/**
 * A fresh issue id whose short form is not one of `taken`.
 *
 * Uniqueness cannot come from the prefix itself — see SHORT_ID_LEN — so it
 * comes from allocation. Since those 13 characters are the creation
 * millisecond and nothing else, a free prefix is a free millisecond, and one
 * can always be found by stepping the clock forward: `taken` is finite, so at
 * most `taken.length` steps reach a millisecond nobody has used. There is no
 * retry-on-random here and no way for the loop to spin.
 *
 * What that costs is a little honesty in the id's embedded timestamp: a burst
 * of N issues filed in the same tick pushes the last one up to N milliseconds
 * into the future. Nothing reads it. `created` is a separate field taken from
 * the real clock, and the only thing the id's ordering is asked for is that
 * issue filenames sort chronologically — which a burst of consecutive
 * milliseconds satisfies exactly, so long as `taken` really is everything
 * minted so far. That is the caller's half of the bargain, and it is the same
 * half uniqueness depends on.
 *
 * The ids are passed in rather than read from disk here so that this module
 * stays clear of the store. It also puts the answer's validity where it
 * belongs: `addIssue` lists the issues and writes the new file without
 * releasing the project lock, so no second process can mint a colliding id in
 * the gap.
 */
export function newId(taken: readonly string[]): string {
  const used = new Set(taken.map(shortId));
  // The clock is read here rather than left to uuid because choosing the
  // millisecond is the entire mechanism, and `v7` only offers that as an
  // explicit `msecs`. Passing it also bypasses uuid's own per-millisecond
  // counter, which is no loss: two ids never share a millisecond now, so
  // there is nothing for it to order.
  let msecs = Date.now();
  for (;;) {
    const id = uuidv7({ msecs });
    if (!used.has(shortId(id))) return id;
    msecs++;
  }
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
