/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'node:fs';
import { nowIso } from '../core/clock.js';
import { DzError } from '../core/errors.js';
import { newId } from '../core/id.js';
import { addComment, closeIssue, createIssue, setField, setStatus } from '../core/mutate.js';
import { parseIssue } from '../core/serialize.js';
import { ISSUE_TYPES, RESOLUTIONS } from '../core/types.js';
import type { Issue, IssueType, Resolution } from '../core/types.js';
import { assertSettableStatus, validateEnum, validateIssue } from '../core/validate.js';
import { loadConfig, saveConfig } from '../store/config.js';
import { repair } from '../store/doctor.js';
import type { Repair } from '../store/doctor.js';
import { resolveAuthor } from '../store/identity.js';
import {
  findIssue, issuePath, listIssueIds, loadAllIssues, parseIssueFile, readIssueText,
  resolveIssueId, writeIssue,
} from '../store/issues.js';
import { breakLock } from '../store/lock.js';
import { withLock } from './session.js';
import type { Session } from './session.js';

export interface NewIssue {
  title: string;
  type: string;
  component?: string | null;
  body?: string;
}

export interface EditableFields {
  status?: string;
  title?: string;
  type?: string;
  /** null clears it. */
  component?: string | null;
  /** null clears it. */
  assignee?: string | null;
}

export function addIssue(s: Session, fields: NewIssue): Issue {
  return withLock(s, 'add', () => {
    const config = loadConfig(s.root);
    // The ids already on disk are what keeps the new one's short form
    // unambiguous, and only the lock keeps that list true: the listing and the
    // write below happen without releasing it, so a second `dz add` cannot
    // slip a colliding id into the gap.
    const issue = createIssue(
      {
        id: newId(listIssueIds(s.root)),
        title: fields.title,
        type: validateEnum<IssueType>(fields.type, ISSUE_TYPES, 'type'),
        component: fields.component ?? null,
        body: fields.body ?? '',
      },
      resolveAuthor(s.root, s.env),
      nowIso(),
    );
    validateIssue(issue, config);
    writeIssue(s.root, issue);
    return issue;
  });
}

export function setFields(s: Session, prefix: string, fields: EditableFields): Issue {
  const given = Object.values(fields).filter((v) => v !== undefined);
  if (given.length === 0) {
    throw new DzError(
      'INVALID_FIELD',
      'no field given; set at least one of status, title, type, component, assignee',
    );
  }

  return withLock(s, 'set', () => {
    const config = loadConfig(s.root);
    const author = resolveAuthor(s.root, s.env);
    const at = nowIso();

    let issue: Issue = findIssue(s.root, prefix);
    if (fields.status !== undefined) {
      assertSettableStatus(fields.status);
      issue = setStatus(issue, fields.status, author, at);
    }
    if (fields.title !== undefined) issue = setField(issue, 'title', fields.title, config, author, at);
    if (fields.type !== undefined) issue = setField(issue, 'type', fields.type, config, author, at);
    if (fields.component !== undefined) {
      issue = setField(issue, 'component', fields.component, config, author, at);
    }
    if (fields.assignee !== undefined) {
      issue = setField(issue, 'assignee', fields.assignee, config, author, at);
    }

    validateIssue(issue, config);
    writeIssue(s.root, issue);
    return issue;
  });
}

export function commentOn(s: Session, prefix: string, text: string): Issue {
  return withLock(s, 'comment', () => {
    const author = resolveAuthor(s.root, s.env);
    const issue = addComment(findIssue(s.root, prefix), text, author, nowIso());
    // Appending a comment cannot itself break an invariant, but every other
    // mutating operation validates before writing and a uniform path is worth
    // more than the skipped check saves.
    validateIssue(issue, loadConfig(s.root));
    writeIssue(s.root, issue);
    return issue;
  });
}

export function closeIssueBy(
  s: Session,
  prefix: string,
  as: string,
  comment: string | null = null,
): Issue {
  return withLock(s, 'close', () => {
    const config = loadConfig(s.root);
    const author = resolveAuthor(s.root, s.env);
    const resolution = validateEnum<Resolution>(as, RESOLUTIONS, 'resolution');

    const issue = closeIssue(findIssue(s.root, prefix), resolution, comment, author, nowIso());
    validateIssue(issue, config);
    writeIssue(s.root, issue);
    return issue;
  });
}

export interface EditSource {
  issue: Issue;
  /** The exact bytes on disk, which a later saveEdited compares against. */
  baseline: string;
}

/**
 * Reads an issue and the bytes an editing session starts from.
 *
 * A single read: the id is resolved, the file is read once, and that same
 * text is both parsed into `issue` and returned as `baseline`. Reading the
 * file a second time to build one of the two would let a writer land in
 * between, handing back a stale issue paired with a fresh baseline — which
 * would make a later `saveEdited` pass its compare-and-swap while discarding
 * the intervening write.
 */
export function readForEdit(s: Session, prefix: string): EditSource {
  const id = resolveIssueId(s.root, prefix);
  const baseline = readIssueText(s.root, id);
  return { issue: parseIssueFile(s.root, id, baseline), baseline };
}

/**
 * Parses edited text back into an issue, enforcing the two things a raw parse
 * does not: that the id was not changed, and that the result still validates
 * against the current config.
 */
export function parseEdit(s: Session, text: string, original: Issue): Issue {
  // writeIssue picks its destination from issue.id, and parseIssue does not
  // check the id against the filename — only readIssue does, and this path
  // bypasses it. A changed id would leave the original alone, create a second
  // issue, and silently overwrite any issue using it.
  const issue = parseIssue(text, 'the edited text');
  if (issue.id !== original.id) {
    throw new DzError(
      'INVALID_FIELD',
      `the id may not be changed by an edit: it was "${original.id}" and is now `
      + `"${issue.id}". Ids are identity; there is no rename operation.`,
    );
  }
  validateIssue(issue, loadConfig(s.root));
  return issue;
}

export type SaveResult =
  | { saved: true; issue: Issue }
  | { saved: false; current: string | null };

/**
 * Writes `issue` only if its file on disk still contains exactly `baseline`.
 *
 * This is the compare-and-swap that makes editing outside the lock safe. The
 * editor runs unlocked for however long a human takes; the comparison happens
 * under the lock, immediately before the write.
 *
 * A conflict is a result, not an error: the caller gets the current bytes so
 * it can offer to reload them. Forcing is not a parameter — it is this same
 * call with the conflicting bytes as the new baseline, which is why a forced
 * write still cannot clobber a version nobody has seen.
 *
 * A null baseline means "there was no file", which is the same value a
 * conflict reports for a deleted issue. Without it, recreating one that
 * vanished mid-edit would be a comparison that can never succeed.
 */
export function saveEdited(s: Session, issue: Issue, baseline: string | null): SaveResult {
  return withLock(s, 'edit', () => {
    const target = issuePath(s.root, issue.id);
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (current !== baseline) return { saved: false, current };

    // Re-validate under the lock. The caller's check ran before the lock was
    // taken, and a caller can wait on a human in between — dz edit re-prompts
    // when the file has moved on — so a `component rm --force` landing in that
    // window invalidates an issue that was valid when it was last checked.
    validateIssue(issue, loadConfig(s.root));
    writeIssue(s.root, issue);
    return { saved: true, issue };
  });
}

export function listComponents(s: Session): string[] {
  return loadConfig(s.root).components;
}

export function addComponent(
  s: Session,
  name: string,
): { components: string[]; added: boolean } {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new DzError('INVALID_FIELD', 'a component name cannot be empty');
  }
  return withLock(s, 'component add', () => {
    const config = loadConfig(s.root);
    // Idempotent: re-adding is what a script or an agent does on a rerun, and
    // failing there would be noise rather than information. `added` is
    // reported rather than left for the caller to infer, so a caller wording a
    // message does not have to re-read the list outside this lock and race.
    if (config.components.includes(trimmed)) {
      return { components: config.components, added: false };
    }

    const components = [...config.components, trimmed].sort();
    saveConfig(s.root, { ...config, components });
    return { components, added: true };
  });
}

export function removeComponent(s: Session, name: string, force = false): string[] {
  return withLock(s, 'component rm', () => {
    const config = loadConfig(s.root);

    // Removing something that is not there is almost always a typo, so it is
    // an error rather than a silent success. `add` is the idempotent one.
    if (!config.components.includes(name)) {
      throw new DzError(
        'NOT_FOUND',
        config.components.length === 0
          ? `no component "${name}"; dz/config.yaml lists no components yet`
          : `no component "${name}"; dz/config.yaml lists ${config.components.join(', ')}`,
      );
    }

    // Removing a component in use is what creates issues that cannot be
    // modified afterwards, which `dz doctor` then reports. Say so first.
    const inUse = loadAllIssues(s.root).issues.filter((i) => i.component === name);
    if (inUse.length > 0 && !force) {
      const ids = inUse.map((i) => `  ${i.id}  ${i.title}`).join('\n');
      throw new DzError(
        'INVALID_FIELD',
        `${inUse.length === 1 ? '1 issue still uses' : `${inUse.length} issues still use`} component "${name}":\n${ids}\n`
        + `reassign them with 'dz set --component', or pass --force to remove it anyway. `
        + `Forcing leaves those issues unmodifiable until their component is changed; 'dz doctor' will report them.`,
      );
    }

    const components = config.components.filter((c) => c !== name);
    saveConfig(s.root, { ...config, components });
    return components;
  });
}

/**
 * The one repair `dz doctor --fix` performs, behind the project lock.
 *
 * `store/doctor.ts` is otherwise diagnosis-only; this writes, so it belongs
 * with the other writes and takes the lock the same way they do rather than
 * leaving the caller to remember. The CLI used to reach into the store and
 * lock for itself, which is exactly the arrangement this facade exists to end.
 */
export function repairProject(s: Session): Repair[] {
  return withLock(s, 'doctor --fix', () => repair(s.root));
}

/**
 * Removes a lock this session does not hold, for `dz unlock`. See breakLock in
 * store/lock.ts for why this narrows the race rather than closing it.
 */
export function breakProjectLock(s: Session, expectedToken: string | null): boolean {
  return breakLock(s.root, expectedToken);
}
