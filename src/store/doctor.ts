/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { Config, Issue } from '../core/types.js';
import { validateIssue } from '../core/validate.js';
import { IGNORE_LINES, loadConfig } from './config.js';
import { resolveAuthor } from './identity.js';
import { issuePath, loadAllIssues } from './issues.js';
import { lockPath, lockState } from './lock.js';
import { configPath, dzDir, issuesDir, localConfigPath } from './root.js';

/**
 * One problem found by `dz doctor`, with what to do about it.
 *
 * Diagnosis only: nothing here repairs anything. A malformed issue file is
 * someone's data, and guessing at a fix could destroy content the tool cannot
 * reconstruct. Spec §2 also treats "needs a repair command to police it" as a
 * cost, and cites avoiding one as a reason for this design.
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

function checkAuthor(root: string, env: NodeJS.ProcessEnv): Diagnosis[] {
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
export function diagnose(root: string, env: NodeJS.ProcessEnv): Diagnosis[] {
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
    ...checkStrayFiles(root),
  ];
}
