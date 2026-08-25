/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { newId, isUuid, resolvePrefix } from './id.js';
import { DzError } from './errors.js';

describe('newId', () => {
  it('produces a well-formed v7 uuid', () => {
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('is monotonic within a millisecond, so filename order is chronological', () => {
    const ids = Array.from({ length: 5000 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
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

