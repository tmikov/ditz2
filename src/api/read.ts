/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Issue } from '../core/types.js';
import { diagnose } from '../store/doctor.js';
import type { Diagnosis } from '../store/doctor.js';
import { findIssue, loadAllIssues } from '../store/issues.js';
import type { LoadResult } from '../store/issues.js';
import { lockState } from '../store/lock.js';
import type { LockState } from '../store/lock.js';
import { applyFilter, compilePattern, matchesRe } from './filter.js';
import type { Filter } from './filter.js';
import type { Session } from './session.js';

/**
 * Reads take no lock. Every write replaces a file atomically, so a reader sees
 * one whole version or another, and a stuck lock must never block reading.
 */
export function listIssues(s: Session, f: Filter = {}): LoadResult {
  const { issues, failures } = loadAllIssues(s.root);
  return { issues: applyFilter(issues, f), failures };
}

export function showIssue(s: Session, prefix: string): Issue {
  return findIssue(s.root, prefix);
}

export function grepIssues(s: Session, pattern: string, f: Filter = {}): LoadResult {
  // Compiled before the load, not after: an invalid regex is a usage error and
  // must not cost a full read of every issue first.
  const re = compilePattern(pattern);
  const { issues, failures } = loadAllIssues(s.root);
  return { issues: applyFilter(issues, f).filter((i) => matchesRe(i, re)), failures };
}

export function diagnoseProject(s: Session): Diagnosis[] {
  return diagnose(s.root, s.env);
}

export function projectLockState(s: Session): LockState {
  return lockState(s.root);
}
