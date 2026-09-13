/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { newId, isUuid, resolvePrefix, shortId } from './id.js';
import { DzError } from './errors.js';

/**
 * The id a v7 generator would produce in `msecs`, with a fixed tail. Only the
 * short id — the 48-bit big-endian timestamp, as twelve hex digits split by
 * the first dash — has to be faithful, and it is.
 */
function idAtMillisecond(msecs: number): string {
  const hex = msecs.toString(16).padStart(12, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8)}-7000-8000-000000000000`;
}

/** A run minted the way `addIssue` mints one: every id so far handed back. */
function burst(n: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) ids.push(newId(ids));
  return ids;
}

describe('newId', () => {
  it('produces a well-formed v7 uuid', () => {
    expect(newId([])).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('gives every id a short id of its own, however fast it is called', () => {
    // A thousand of these take a fraction of the thousand milliseconds they
    // would need to get distinct timestamps honestly, so most have to be
    // placed by stepping the clock rather than reading it. Before that, the
    // short id was the millisecond and nothing else, and a run like this one
    // handed out a couple of hundred distinct names for a thousand issues.
    const ids = burst(1000);
    expect(new Set(ids.map(shortId)).size).toBe(ids.length);
  });

  it('is monotonic within a millisecond, so filename order is chronological', () => {
    const ids = burst(1000);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('steps past a whole run of short ids that are already taken', () => {
    // Deliberately not a timing test. A UUIDv7's short id is exactly its
    // millisecond in hex, so a millisecond can be reserved by writing one
    // down; this reserves every one from now to a full second out. An
    // allocator that read the clock and ignored `taken` would land inside
    // that second no matter how the test is scheduled.
    const now = Date.now();
    const taken = Array.from({ length: 1000 }, (_, i) => idAtMillisecond(now + i));
    const id = newId(taken);
    expect(isUuid(id)).toBe(true);
    expect(taken.map(shortId)).not.toContain(shortId(id));
  });
});

describe('isUuid', () => {
  it('accepts a real uuid and rejects near-misses', () => {
    expect(isUuid('0198f2b0-9d17-7a55-8c31-6e2b0f9a4d12')).toBe(true);
    expect(isUuid('0198f2b0')).toBe(false);
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});

const REFS = [
  { id: '0198f2a1-6b41-7c3d-9e02-1f4a8c5d3b77', title: 'Parser drops newline' },
  { id: '0198f2b0-9d17-7a55-8c31-6e2b0f9a4d12', title: 'Add --json to list' },
  { id: '0198f2b0-aaaa-7000-8000-000000000000', title: 'Colliding prefix' },
];

describe('resolvePrefix', () => {
  it('resolves an unambiguous prefix', () => {
    expect(resolvePrefix('0198f2a1', REFS).title).toBe('Parser drops newline');
  });

  it('resolves a full-length id', () => {
    expect(resolvePrefix(REFS[1].id, REFS).id).toBe(REFS[1].id);
  });

  it('rejects an ambiguous prefix and names every candidate with its title', () => {
    try {
      resolvePrefix('0198f2b0', REFS);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DzError);
      expect((err as DzError).code).toBe('AMBIGUOUS_PREFIX');
      expect((err as DzError).message).toContain('Add --json to list');
      expect((err as DzError).message).toContain('Colliding prefix');
    }
  });

  it('rejects a prefix that matches nothing', () => {
    expect(() => resolvePrefix('ffffffff', REFS)).toThrow(/no issue matches/);
  });

  it('rejects an empty prefix rather than silently matching the first issue', () => {
    try {
      resolvePrefix('', REFS);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('NOT_FOUND');
    }
  });
});

