/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { validateIssue, assertSettableStatus, validateComponent } from './validate.js';
import { DzError } from './errors.js';
import type { Config, Issue } from './types.js';

const CONFIG: Config = { name: 'ditz2', components: ['core', 'cli', 'docs'] };

function issue(over: Partial<Issue> = {}): Issue {
  return {
    id: '0198f2b0-9d17-7a55-8c31-6e2b0f9a4d12',
    title: 'A title', type: 'bug', status: 'open', resolution: null,
    component: 'core', assignee: null,
    created: '2026-08-22T09:14:03.221Z', creator: 'T <t@example.com>',
    body: '', log: [], unknown: {},
    ...over,
  };
}

describe('validateIssue', () => {
  it('accepts a well-formed open issue', () => {
    expect(() => validateIssue(issue(), CONFIG)).not.toThrow();
  });

  it('requires a resolution exactly when the issue is closed', () => {
    expect(() => validateIssue(issue({ status: 'closed', resolution: null }), CONFIG))
      .toThrow(/closed issue must have a resolution/);
    expect(() => validateIssue(issue({ status: 'open', resolution: 'fixed' }), CONFIG))
      .toThrow(/only a closed issue may have a resolution/);
    expect(() => validateIssue(issue({ status: 'closed', resolution: 'fixed' }), CONFIG))
      .not.toThrow();
  });

  it('rejects a component that is not configured, naming the valid ones', () => {
    try {
      validateIssue(issue({ component: 'nope' }), CONFIG);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('INVALID_FIELD');
      expect((err as DzError).message).toContain('core, cli, docs');
    }
  });

  it('accepts a null component', () => {
    expect(() => validateIssue(issue({ component: null }), CONFIG)).not.toThrow();
  });

  it('rejects an id that is not a uuid', () => {
    expect(() => validateIssue(issue({ id: 'nope' }), CONFIG)).toThrow(/not a valid uuid/);
  });

  it('skips component checking when no config is available', () => {
    expect(() => validateIssue(issue({ component: 'anything' }), null)).not.toThrow();
  });
});

describe('assertSettableStatus', () => {
  it("rejects 'closed' and points at the close command", () => {
    try {
      assertSettableStatus('closed');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('INVALID_FIELD');
      expect((err as DzError).message).toContain('dz close');
      expect((err as DzError).message).toContain('--as');
    }
  });

  it('allows open and in-progress, which is the reopen path', () => {
    expect(() => assertSettableStatus('open')).not.toThrow();
    expect(() => assertSettableStatus('in-progress')).not.toThrow();
  });

  it('rejects a status outside the vocabulary', () => {
    expect(() => assertSettableStatus('paused')).toThrow(/expected one of/);
  });
});

describe('validateComponent', () => {
  it('rejects an unconfigured component', () => {
    expect(() => validateComponent('nope', CONFIG)).toThrow(/INVALID|not a configured/);
  });
});
