/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Diagnosis, Repair } from '../store/doctor.js';
import type { LoadResult } from '../store/issues.js';
import type { LockState } from '../store/lock.js';
import { findProjectRoot } from '../store/root.js';
import { loadConfig } from '../store/config.js';
import { resolveAuthor } from '../store/identity.js';
import { diagnoseProject, grepIssues, listIssues, projectLockState, showIssue } from './read.js';
import {
  addComponent, addIssue, breakProjectLock, closeIssueBy, commentOn,
  repairProject,
  listComponents, parseEdit, readForEdit, removeComponent, saveEdited, setFields,
} from './write.js';
import type { Session } from './session.js';
import type { Filter } from './filter.js';
import type { EditableFields, EditSource, NewIssue, SaveResult } from './write.js';
import type { Env, Issue } from '../core/types.js';

export type { Filter } from './filter.js';
export type { EditableFields, EditSource, NewIssue, SaveResult } from './write.js';
export type { Diagnosis, Repair } from '../store/doctor.js';
export type { LoadFailure, LoadResult } from '../store/issues.js';
export type { LockInfo, LockState } from '../store/lock.js';
export type {
  Config, Env, Issue, IssueType, LogEntry, Resolution, Status,
} from '../core/types.js';
export { DEFAULT_ISSUE_TYPE, ISSUE_TYPES, RESOLUTIONS, STATUSES } from '../core/types.js';
export { SETTABLE_STATUSES } from '../core/validate.js';
export type { SettableStatus } from '../core/validate.js';
export { DzError } from '../core/errors.js';
export type { DzErrorCode } from '../core/errors.js';
export { SCHEMA_VERSION, JSON_SCHEMA } from '../render/schema.js';
export { applyFilter, matchIssues } from './filter.js';
export { shortId } from '../render/human.js';

export interface ProjectOptions {
  /**
   * Used for author resolution. Required rather than defaulted to process.env,
   * so no operation ever reads global state behind the caller's back.
   */
  env: Env;
  /**
   * Overrides DZ_LOCK_TIMEOUT_MS. Pass 0 to fail immediately instead of
   * sleeping — a UI cannot afford a synchronous wait, because it blocks
   * repaint, keyboard input and Ctrl-C.
   */
  lockTimeoutMs?: number;
}

export interface Project {
  readonly root: string;
  /** From dz/config.yaml, re-read on access so a refresh sees a rename. */
  readonly name: string;
  /**
   * The author mutations would be recorded under, or null when none is
   * configured. Null rather than a throw: reading a backlog must not require
   * an identity, and only writes do.
   */
  whoami(): string | null;

  list(filter?: Filter): LoadResult;
  show(prefix: string): Issue;
  grep(pattern: string, filter?: Filter): LoadResult;

  add(fields: NewIssue): Issue;
  set(prefix: string, fields: EditableFields): Issue;
  comment(prefix: string, text: string): Issue;
  close(prefix: string, as: string, comment?: string | null): Issue;

  components: {
    list(): string[];
    add(name: string): { components: string[]; added: boolean };
    remove(name: string, force?: boolean): string[];
  };

  doctor(): Diagnosis[];
  /** Applies the repairs `doctor` reports as fixable. Takes the lock. */
  repair(): Repair[];
  lock: {
    state(): LockState;
    break(expectedToken: string | null): boolean;
  };

  /**
   * The edit flow: read the issue and the bytes it came from, parse whatever
   * the user made of them, then save against that same baseline.
   */
  readForEdit(prefix: string): EditSource;
  parseEdit(text: string, original: Issue): Issue;
  saveEdited(issue: Issue, baseline: string | null): SaveResult;
}

/**
 * Opens the project containing `cwd`.
 *
 * Throws NO_PROJECT immediately when there is no dz/config.yaml, so a consumer
 * fails at startup rather than on its first operation.
 *
 * Every method is synchronous. ditz2 is synchronous end to end, and an async
 * wrapper around synchronous file IO would only be theatre.
 */
export function openProject(cwd: string, opts: ProjectOptions): Project {
  const s: Session = {
    root: findProjectRoot(cwd),
    env: opts.env,
    lockTimeoutMs: opts.lockTimeoutMs,
  };

  return {
    root: s.root,
    get name() { return loadConfig(s.root).name; },
    whoami: () => {
      try {
        return resolveAuthor(s.root, s.env);
      } catch {
        return null;
      }
    },

    list: (filter) => listIssues(s, filter),
    show: (prefix) => showIssue(s, prefix),
    grep: (pattern, filter) => grepIssues(s, pattern, filter),

    add: (fields) => addIssue(s, fields),
    set: (prefix, fields) => setFields(s, prefix, fields),
    comment: (prefix, text) => commentOn(s, prefix, text),
    close: (prefix, as, comment) => closeIssueBy(s, prefix, as, comment ?? null),

    components: {
      list: () => listComponents(s),
      add: (name) => addComponent(s, name),
      remove: (name, force) => removeComponent(s, name, force ?? false),
    },

    doctor: () => diagnoseProject(s),
    repair: () => repairProject(s),
    lock: {
      state: () => projectLockState(s),
      break: (expectedToken) => breakProjectLock(s, expectedToken),
    },

    readForEdit: (prefix) => readForEdit(s, prefix),
    parseEdit: (text, original) => parseEdit(s, text, original),
    saveEdited: (issue, baseline) => saveEdited(s, issue, baseline),
  };
}
