/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { Config, Env, Issue } from '../core/types.js';
import { parseIssue } from '../core/serialize.js';
import { validateIssue } from '../core/validate.js';
import { IGNORE_LINES, loadConfig } from './config.js';
import { resolveAuthor } from './identity.js';
import { issuePath, loadAllIssues, writeFileAtomic } from './issues.js';
import { lockPath, lockState } from './lock.js';
import { configPath, dzDir, issuesDir, localConfigPath } from './root.js';

/**
 * One problem found by `dz doctor`, with what to do about it.
 *
 * Diagnosis, with one narrow exception. A malformed issue file is someone's
 * data, and guessing at a fix could destroy content the tool cannot
 * reconstruct. Spec §2 also treats "needs a repair command to police it" as a
 * cost, and cites avoiding one as a reason for this design. So every remedy
 * here is prose for a person to act on, except the trailing whitespace dz
 * wrote itself, which `repair` strips under an explicit --fix and only where
 * the result parses to an identical issue.
 */
export interface Diagnosis {
  code: string;
  /** Project-relative path this concerns, or null if it is project-wide. */
  file: string | null;
  message: string;
  remedy: string;
}

/**
 * Without dz/.gitignore, the identity file is committed, and anyone who clones
 * the repository silently authors their log entries as whoever wrote it. A
 * committed lock file is worse still: it names a foreign host, so every
 * mutation fails LOCKED and no dz command can remove it for good.
 *
 * The required lines come from `initProject`, not from a copy kept here. A
 * second copy is how this check came to certify a .gitignore that init would
 * have added a line to.
 */
function checkGitignore(root: string): Diagnosis[] {
  const file = path.join(dzDir(root), '.gitignore');
  const rel = path.relative(root, file);
  const identity = path.relative(root, localConfigPath(root));
  const quoted = IGNORE_LINES.map((l) => `"${l}"`).join(' and ');

  if (!fs.existsSync(file)) {
    return [{
      code: 'GITIGNORE_MISSING',
      file: rel,
      message: `${rel} is missing, so ${identity} is not ignored`,
      remedy: `run 'dz init' here again, which appends the lines it needs, or create ${rel} containing ${quoted}. Until then ${identity} can be committed, and anyone who clones the repository authors their log entries as you.`,
    }];
  }

  const lines = fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim());
  return IGNORE_LINES.filter((needed) => !lines.includes(needed)).map((needed) => ({
    code: 'GITIGNORE_INCOMPLETE',
    file: rel,
    message: `${rel} does not ignore ${needed}`,
    remedy: `add the line "${needed}" to ${rel}, or run 'dz init' here again, which appends whatever is missing. It is idempotent.`,
  }));
}

/** loadConfig coerces bad values to defaults, so nothing else reports these. */
function checkConfig(root: string): Diagnosis[] {
  const rel = path.relative(root, configPath(root));
  let raw: unknown;
  try {
    raw = YAML.parse(fs.readFileSync(configPath(root), 'utf8'));
  } catch (err) {
    return [{
      code: 'CONFIG_UNREADABLE',
      file: rel,
      message: `${rel} is not valid YAML: ${(err as Error).message}`,
      remedy: `fix the syntax. Until then the project reads as unnamed with no components, and every --component is rejected.`,
    }];
  }

  const obj = (raw ?? {}) as Record<string, unknown>;
  const found: Diagnosis[] = [];
  if (typeof obj['name'] !== 'string') {
    found.push({
      code: 'CONFIG_MALFORMED',
      file: rel,
      message: `${rel}: "name" is not a string, so it is being ignored`,
      remedy: `set "name" to the project name.`,
    });
  }
  const components = obj['components'];
  if (components !== undefined && !Array.isArray(components)) {
    found.push({
      code: 'CONFIG_MALFORMED',
      file: rel,
      message: `${rel}: "components" is not a list, so it is being ignored`,
      remedy: `make "components" a YAML list. While it is ignored, every --component value is rejected.`,
    });
  } else if (Array.isArray(components)) {
    // loadConfig filters non-strings out silently, so an entry like `- 123`
    // simply vanishes and nothing else ever mentions it.
    for (const entry of components) {
      if (typeof entry !== 'string') {
        found.push({
          code: 'CONFIG_MALFORMED',
          file: rel,
          message: `${rel}: component ${JSON.stringify(entry)} is not a string, so it is being ignored`,
          remedy: `quote it, or remove it. As it stands that component cannot be used with --component.`,
        });
      }
    }
  }
  return found;
}

/**
 * A component removed from config.yaml leaves existing issues referring to it.
 * Nothing surfaces that until some unrelated command on the issue fails
 * validation, which reads as a bug in the command the user actually ran.
 */
function checkComponents(root: string, issues: Issue[], config: Config): Diagnosis[] {
  const known = new Set(config.components);
  return issues
    .filter((i) => i.component !== null && !known.has(i.component))
    .map((i) => ({
      code: 'UNKNOWN_COMPONENT',
      file: path.relative(root, issuePath(root, i.id)),
      message: `issue ${i.id} has component "${String(i.component)}", which ${path.relative(root, configPath(root))} does not list`,
      remedy: `add "${String(i.component)}" back to components in config.yaml, or reassign the issue with 'dz set --component'. Until then every change to this issue is rejected.`,
    }));
}

/**
 * parseIssue checks syntax; validateIssue checks the invariants. Nothing runs
 * the latter on a read, deliberately, so that `show` can still display a file
 * you are trying to inspect. The cost is that a bad combination sits unnoticed
 * until some later mutation fails and blames the command the user just ran.
 * This is the one place that goes looking for it.
 */
function checkInvariants(root: string, issues: Issue[]): Diagnosis[] {
  const found: Diagnosis[] = [];
  for (const issue of issues) {
    try {
      // Components are reported separately, with a remedy of their own.
      validateIssue(issue, null);
    } catch (err) {
      found.push({
        code: 'INVALID_ISSUE',
        file: path.relative(root, issuePath(root, issue.id)),
        message: (err as Error).message,
        remedy: `dz reads this file, so list and show still display it, but every change to it is rejected. Fix the frontmatter by hand.`,
      });
    }
  }
  return found;
}

function checkAuthor(root: string, env: Env): Diagnosis[] {
  try {
    resolveAuthor(root, env);
    return [];
  } catch (err) {
    return [{
      code: 'NO_AUTHOR',
      file: null,
      message: (err as Error).message,
      remedy: `set DZ_AUTHOR="Name <email>", or add an author to ${path.relative(root, localConfigPath(root))}. Commands that only read, like list and show, keep working.`,
    }];
  }
}

function checkIssuesDir(root: string): Diagnosis[] {
  const dir = issuesDir(root);
  if (fs.existsSync(dir)) return [];
  const rel = path.relative(root, dir);
  return [{
    code: 'ISSUES_DIR_MISSING',
    file: rel,
    message: `${rel} does not exist, so the project reads as empty`,
    remedy: `recreate it, or run 'dz init' here again. 'dz list' shows nothing rather than failing, so this is easy to mistake for an empty project.`,
  }];
}

/**
 * `lockState` is the single predicate for whether a lock is abandoned; this
 * only translates its verdict into a Diagnosis. `unlock` calls the same
 * predicate, so the two cannot disagree about what needs fixing.
 */
function checkLock(root: string): Diagnosis[] {
  const state = lockState(root);
  const rel = path.relative(root, lockPath(root));

  if (state.kind === 'abandoned') {
    return [{
      code: 'ABANDONED_LOCK',
      file: rel,
      message: `${rel} is held by a process that is gone: ${state.why}`,
      remedy: `run 'dz unlock' to remove it. Every mutating command refuses while it is here.`,
    }];
  }
  if (state.kind === 'malformed') {
    return [{
      code: 'MALFORMED_LOCK',
      file: rel,
      message: `${rel} exists but ${state.why}`,
      remedy: `run 'dz unlock --force' to remove it. It cannot be judged abandoned, so unlock will not remove it without --force.`,
    }];
  }
  // An active lock means another command is working right now. Transient, not
  // a defect, so doctor says nothing about it.
  return [];
}

const TRAILING_RE = /[ \t]+$/;
/** Enough to find them by hand without turning the message into a listing. */
const MAX_LINES_NAMED = 10;

interface TrailingHit {
  file: string;
  rel: string;
  lines: number[];
  /** The trimmed text, or null if trimming would change what dz reads back. */
  trimmed: string | null;
}

/**
 * The trimmed file, but only when trimming provably changes nothing: both
 * spellings are parsed and the resulting issues compared. Trailing whitespace
 * on a blank line is layout, and every version before this one wrote an
 * in-comment blank line as four spaces. Trailing whitespace after real text is
 * content — two spaces are a markdown line break — and stripping it would
 * rewrite what someone typed. Nothing here can tell the two apart by looking;
 * the round-trip can, so it decides.
 */
function trimmedIfContentPreserving(text: string, rel: string): string | null {
  const trimmed = text.split('\n').map((l) => l.replace(TRAILING_RE, '')).join('\n');
  if (trimmed === text) return null;
  try {
    const before = parseIssue(text, rel);
    const after = parseIssue(trimmed, rel);
    // Issues are plain data, so this compares every field including `unknown`.
    if (JSON.stringify(before) !== JSON.stringify(after)) return null;
  } catch {
    // Unparseable, and reported as such already. A file dz cannot read is one
    // it has no business rewriting.
    return null;
  }
  return trimmed;
}

function trailingHits(root: string): TrailingHit[] {
  const dir = issuesDir(root);
  if (!fs.existsSync(dir)) return [];
  const hits: TrailingHit[] = [];
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort()) {
    const file = path.join(dir, name);
    const rel = path.relative(root, file);
    const text = fs.readFileSync(file, 'utf8');
    const lines = text
      .split('\n')
      .flatMap((line, i) => (TRAILING_RE.test(line) ? [i + 1] : []));
    if (lines.length === 0) continue;
    hits.push({ file, rel, lines, trimmed: trimmedIfContentPreserving(text, rel) });
  }
  return hits;
}

/**
 * Trailing whitespace is invisible and nothing preserves it: an editor that
 * strips on save, `git apply --whitespace=fix`, or any of the whitespace lints
 * a repository is likely to already run will all quietly rewrite these files.
 * It is worth reporting because dz used to put it there itself.
 */
function checkTrailingWhitespace(root: string): Diagnosis[] {
  return trailingHits(root).map(({ rel, lines, trimmed }) => {
    const named = lines.slice(0, MAX_LINES_NAMED).join(', ');
    const rest = lines.length > MAX_LINES_NAMED ? `, and ${lines.length - MAX_LINES_NAMED} more` : '';
    return {
      code: 'TRAILING_WHITESPACE',
      file: rel,
      message: `${rel} has trailing whitespace on line ${named}${rest}`,
      remedy: trimmed === null
        ? `strip it by hand if you meant to. 'dz doctor --fix' will not: here the whitespace follows real text, where two trailing spaces are a markdown line break, so removing it would change the file's content.`
        : `run 'dz doctor --fix'. Versions before this one wrote a blank line inside a log comment as four spaces; stripping it back is checked to leave everything dz reads unchanged.`,
    };
  });
}

/** One thing `dz doctor --fix` did. */
export interface Repair {
  file: string;
  message: string;
}

/**
 * The exception to this file being diagnosis-only, and deliberately a narrow
 * one: it runs only under an explicit --fix, and only writes a file whose
 * parsed content it has already proved identical. Everything else here stays a
 * remedy someone reads and carries out, because a wrong repair to an issue
 * destroys content the tool cannot reconstruct.
 */
export function repair(root: string): Repair[] {
  const done: Repair[] = [];
  for (const { file, rel, lines, trimmed } of trailingHits(root)) {
    if (trimmed === null) continue;
    writeFileAtomic(file, trimmed);
    done.push({
      file: rel,
      message: `stripped trailing whitespace from ${lines.length} line${lines.length === 1 ? '' : 's'}`,
    });
  }
  return done;
}

/** Anything in issues/ that is not an issue: crashed temp writes, stray files. */
function checkStrayFiles(root: string): Diagnosis[] {
  const dir = issuesDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => !name.endsWith('.md'))
    .map((name) => {
      const rel = path.relative(root, path.join(dir, name));
      const orphaned = name.includes('.md.tmp-');
      return {
        code: orphaned ? 'ORPHANED_TEMP_FILE' : 'STRAY_FILE',
        file: rel,
        message: orphaned
          ? `${rel} is a temp file left by an interrupted write`
          : `${rel} is not an issue file`,
        remedy: orphaned
          ? `delete it. The write it belonged to did not complete, so nothing references it.`
          : `dz ignores it, so this is only untidiness. Delete or move it if it does not belong.`,
      };
    });
}

/** Every check, in the order a reader should act on them. */
export function diagnose(root: string, env: Env): Diagnosis[] {
  const { issues, failures } = loadAllIssues(root);

  // A diagnostic must not fall over on the conditions it exists to report.
  // loadConfig throws on unreadable YAML, which is precisely what checkConfig
  // has already described, so the component check is skipped rather than
  // allowed to take the whole command down.
  let config: Config | null = null;
  try {
    config = loadConfig(root);
  } catch {
    config = null;
  }

  return [
    ...checkGitignore(root),
    ...checkIssuesDir(root),
    ...checkLock(root),
    ...checkConfig(root),
    ...checkAuthor(root, env),
    ...failures.map((f) => ({
      code: f.error.code,
      file: f.file,
      message: f.error.message,
      remedy: `dz skips this file, so list and grep exit 1 while it is here. Open it and fix the format by hand; dz will not guess at it.`,
    })),
    ...checkInvariants(root, issues),
    ...(config === null ? [] : checkComponents(root, issues, config)),
    ...checkTrailingWhitespace(root),
    ...checkStrayFiles(root),
  ];
}
