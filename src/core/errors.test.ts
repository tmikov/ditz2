/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { DzError } from './errors.js';

describe('DzError', () => {
  it('carries a machine-readable code alongside the message', () => {
    const err = new DzError('NOT_FOUND', 'no issue matches id prefix "abc"');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('no issue matches id prefix "abc"');
    expect(err.name).toBe('DzError');
  });

  it('is a real Error, so instanceof narrowing works in the cli catch block', () => {
    const err = new DzError('NO_PROJECT', 'no dz/config.yaml found');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DzError);
  });
});
