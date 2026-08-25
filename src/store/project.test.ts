/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findProjectRoot } from './root.js';
import { initProject, loadConfig, saveConfig } from './config.js';
import { resolveAuthor } from './identity.js';
import { DzError } from '../core/errors.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-test-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('initProject', () => {
  it('creates the dz directory, config, issues dir, and gitignore', () => {
    initProject(tmp, 'myproject');
    expect(fs.existsSync(path.join(tmp, 'dz', 'config.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'dz', 'issues'))).toBe(true);
    expect(fs.readFileSync(path.join(tmp, 'dz', '.gitignore'), 'utf8'))
      .toBe('config.local.yaml\n.lock\n');
  });

  it('writes the project name and an empty component list', () => {
    initProject(tmp, 'myproject');
    expect(loadConfig(tmp)).toEqual({ name: 'myproject', components: [] });
  });

  it('is safe to run twice', () => {
    initProject(tmp, 'myproject');
    expect(() => initProject(tmp, 'myproject')).not.toThrow();
  });
});

describe('findProjectRoot', () => {
  it('finds the root from a nested directory', () => {
    initProject(tmp, 'p');
    const nested = path.join(tmp, 'a', 'b', 'c');
    fs.mkdirSync(nested, { recursive: true });
    expect(fs.realpathSync(findProjectRoot(nested))).toBe(fs.realpathSync(tmp));
  });

  it('throws NO_PROJECT when there is no dz/config.yaml anywhere above', () => {
    const orphan = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-orphan-'));
    try {
      findProjectRoot(orphan);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('NO_PROJECT');
    } finally {
      fs.rmSync(orphan, { recursive: true, force: true });
    }
  });
});

describe('saveConfig', () => {
  it('round-trips through loadConfig', () => {
    initProject(tmp, 'p');
    saveConfig(tmp, { name: 'p', components: ['core', 'cli'] });
    expect(loadConfig(tmp).components).toEqual(['core', 'cli']);
  });
});

describe('resolveAuthor', () => {
  it('prefers DZ_AUTHOR over the local config', () => {
    initProject(tmp, 'p');
    fs.writeFileSync(path.join(tmp, 'dz', 'config.local.yaml'), 'author: File <f@x.com>\n');
    expect(resolveAuthor(tmp, { DZ_AUTHOR: 'Env <e@x.com>' })).toBe('Env <e@x.com>');
  });

  it('falls back to config.local.yaml', () => {
    initProject(tmp, 'p');
    fs.writeFileSync(path.join(tmp, 'dz', 'config.local.yaml'), 'author: File <f@x.com>\n');
    expect(resolveAuthor(tmp, {})).toBe('File <f@x.com>');
  });

  it('errors naming both sources when neither is set', () => {
    initProject(tmp, 'p');
    try {
      resolveAuthor(tmp, {});
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).message).toContain('DZ_AUTHOR');
      expect((err as DzError).message).toContain('config.local.yaml');
    }
  });
});

describe('saveConfig', () => {
  it('replaces config.yaml instead of truncating it in place', () => {
    initProject(tmp, 'demo');
    const file = path.join(tmp, 'dz', 'config.yaml');
    const before = fs.statSync(file).ino;

    saveConfig(tmp, { name: 'demo', components: ['core'] });

    // A rename puts a different inode at the path; fs.writeFileSync truncates
    // and refills the same one, which is the window a lock-free reader can
    // catch empty. Checking the inode tests that property directly, where a
    // concurrency test cannot: the file is small enough that the truncated
    // state is almost never observable in practice, so a race-based test
    // passes whether or not the write is atomic.
    expect(fs.statSync(file).ino).not.toBe(before);
    expect(loadConfig(tmp).components).toEqual(['core']);
  });

  it('leaves no temporary file behind', () => {
    initProject(tmp, 'demo');
    saveConfig(tmp, { name: 'demo', components: ['core'] });
    const stray = fs.readdirSync(path.join(tmp, 'dz')).filter((f) => f.includes('.tmp-'));
    expect(stray).toEqual([]);
  });
});
