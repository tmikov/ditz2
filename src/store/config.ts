/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { DzError } from '../core/errors.js';
import type { Config } from '../core/types.js';
import { configPath, dzDir, issuesDir, localConfigPath } from './root.js';

export function loadConfig(root: string): Config {
  let raw: unknown;
  try {
    raw = YAML.parse(fs.readFileSync(configPath(root), 'utf8'));
  } catch (err) {
    throw new DzError('PARSE_ERROR', `cannot read ${configPath(root)}: ${(err as Error).message}`);
  }
  const obj = (raw ?? {}) as Record<string, unknown>;
  const name = typeof obj['name'] === 'string' ? obj['name'] : '';
  const components = Array.isArray(obj['components'])
    ? (obj['components'] as unknown[]).filter((c): c is string => typeof c === 'string')
    : [];
  return { name, components };
}

let tmpCounter = 0;

/**
 * Written through a sibling temporary file and renamed, like issue files.
 *
 * Writing in place would truncate first, and read-only commands deliberately
 * do not take the project lock: `dz list` running while `dz component add`
 * writes would load an empty or half-written config and report every issue's
 * component as unknown. A crash mid-write would leave the truncation committed.
 * The rename is within one directory, so it is atomic and cannot hit EXDEV.
 */
export function saveConfig(root: string, config: Config): void {
  const target = configPath(root);
  const tmp = `${target}.tmp-${process.pid}-${tmpCounter++}`;
  try {
    fs.writeFileSync(tmp, YAML.stringify(config), 'utf8');
    fs.renameSync(tmp, target);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Every line `dz/.gitignore` must carry. `doctor` checks this same list, so the
 * two cannot certify different things as complete.
 *
 * `.lock` matters as much as the identity file: committing one publishes a
 * hostname and pid that are meaningless anywhere else, and a checkout of it
 * looks to `lockState` like a live lock held by an unreachable machine, which
 * no amount of waiting clears.
 */
export const IGNORE_LINES = ['config.local.yaml', '.lock'];

/**
 * Creates dz/ in `dir`, and is safe to re-run over an existing project.
 *
 * The nested dz/.gitignore exists so no VCS detection is needed: it is
 * self-contained, correct inside a monorepo, honored by common VCS tools,
 * and inert outside a repository. It used to be rewritten wholesale on every
 * init, which deleted any other line the user had added. Now the required
 * lines are appended only when absent, which keeps the idempotence and stops
 * the clobbering.
 *
 * Nothing here overwrites an existing file. Re-running init must never cost
 * someone their configuration.
 */
export function initProject(dir: string, name: string): { root: string; created: string[] } {
  const created: string[] = [];
  for (const d of [dzDir(dir), issuesDir(dir)]) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
      created.push(d);
    }
  }

  const ignore = path.join(dzDir(dir), '.gitignore');
  const existing = fs.existsSync(ignore) ? fs.readFileSync(ignore, 'utf8') : '';
  const present = new Set(existing.split('\n').map((l) => l.trim()));
  const missing = IGNORE_LINES.filter((l) => !present.has(l));
  if (missing.length > 0) {
    const prefix = existing === '' || existing.endsWith('\n') ? existing : `${existing}\n`;
    fs.writeFileSync(ignore, `${prefix}${missing.join('\n')}\n`, 'utf8');
    if (existing === '') created.push(ignore);
  }

  if (!fs.existsSync(configPath(dir))) {
    saveConfig(dir, { name, components: [] });
    created.push(configPath(dir));
  }
  return { root: dir, created };
}

export function loadLocalAuthor(root: string): string | null {
  const p = localConfigPath(root);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = YAML.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown> | null;
    const author = raw?.['author'];
    return typeof author === 'string' && author !== '' ? author : null;
  } catch {
    return null;
  }
}

export function saveLocalAuthor(root: string, author: string): void {
  fs.writeFileSync(localConfigPath(root), YAML.stringify({ author }), 'utf8');
}
