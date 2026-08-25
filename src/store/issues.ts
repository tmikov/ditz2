/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DzError } from '../core/errors.js';
import { resolvePrefix } from '../core/id.js';
import { parseIssue, renderIssue } from '../core/serialize.js';
import type { Issue, IssueRef } from '../core/types.js';
import { issuesDir } from './root.js';

const EXT = '.md';
let tmpCounter = 0;

export function issuePath(root: string, id: string): string {
  return path.join(issuesDir(root), `${id}${EXT}`);
}

export function listIssueIds(root: string): string[] {
  const dir = issuesDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(EXT))
    .map((f) => f.slice(0, -EXT.length))
    .sort();
}

export function readIssue(root: string, id: string): Issue {
  const file = issuePath(root, id);
  const rel = path.relative(root, file);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    // Only a genuinely absent file is NOT_FOUND. EACCES or EISDIR mean the file
    // is there and something else is wrong; saying "no issue matches" would lie.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    throw new DzError('NOT_FOUND', `no issue file at ${file}`);
  }
  const issue = parseIssue(text, rel);
  // Spec §5: the frontmatter id must match the filename stem. Only this layer
  // knows the filename, and a mismatch makes the issue unaddressable — `list`
  // would show it while `show` and `set` could not find it.
  if (issue.id !== id) {
    throw new DzError(
      'INVALID_FIELD',
      `${rel}: frontmatter id "${issue.id}" does not match the filename stem "${id}"`,
    );
  }
  return issue;
}

/**
 * Atomic: render to a sibling temp file, then rename. A crash mid-write cannot
 * truncate an issue, and rename within a directory is atomic on POSIX.
 */
export function writeIssue(root: string, issue: Issue): void {
  const target = issuePath(root, issue.id);
  // A project whose issues/ has gone missing is a recoverable state, not a bug
  // in the tool; without this the write failed with a raw ENOENT reported as an
  // internal error. `dz doctor` reports the missing directory separately.
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${tmpCounter++}`;
  const text = renderIssue(issue);
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    // The format's own parser is the write-side validator: free text can collide
    // with the log grammar's delimiters, and a file we cannot read back is worse
    // than a refused write. One extra parse per write costs nothing at this size.
    try {
      parseIssue(text, path.relative(root, target));
    } catch (err) {
      throw new DzError(
        'INVALID_FIELD',
        `refusing to write ${path.relative(root, target)}: its content collides with the issue file format (${(err as Error).message})`,
      );
    }
    fs.renameSync(tmp, target);
  } catch (err) {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
    throw err;
  }
}

export interface LoadFailure {
  file: string;
  error: DzError;
}

export interface LoadResult {
  issues: Issue[];
  failures: LoadFailure[];
}

/** Never fails wholesale: one bad file must not hide the other forty. */
export function loadAllIssues(root: string): LoadResult {
  const issues: Issue[] = [];
  const failures: LoadFailure[] = [];
  for (const id of listIssueIds(root)) {
    try {
      issues.push(readIssue(root, id));
    } catch (err) {
      const file = path.relative(root, issuePath(root, id));
      failures.push({
        file,
        error: err instanceof DzError
          ? err
          : new DzError('PARSE_ERROR', `${file}: ${(err as Error).message}`),
      });
    }
  }
  return { issues, failures };
}

/** A candidate's title for the ambiguity message, or a marker if unreadable. */
function titleOf(root: string, id: string): string {
  try {
    return readIssue(root, id).title;
  } catch {
    // A candidate that will not parse still belongs in the list: the user needs
    // to see that their prefix is ambiguous before they can lengthen it.
    return '(unreadable)';
  }
}

export function findIssue(root: string, prefix: string): Issue {
  // A filename is an id, so resolving a prefix is a directory listing, not a
  // parse of every issue. Titles exist only for the ambiguity message, so they
  // are read from the candidates alone, and only when there is more than one.
  //
  // Searching the stems rather than the successfully-parsed set is also what
  // makes a corrupt or misnamed file reachable: it is found here, and readIssue
  // below reports why it is bad instead of claiming nothing matched.
  const candidates = prefix === ''
    ? [] // resolvePrefix rejects an empty prefix; do not read anything for it.
    : listIssueIds(root).filter((id) => id.startsWith(prefix));

  const refs: IssueRef[] = candidates.length > 1
    ? candidates.map((id) => ({ id, title: titleOf(root, id) }))
    : candidates.map((id) => ({ id, title: '' }));

  return readIssue(root, resolvePrefix(prefix, refs).id);
}
