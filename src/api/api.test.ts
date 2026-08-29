/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DzError } from '../core/errors.js';
import { parseIssue } from '../core/serialize.js';
import { initProject, saveConfig } from '../store/config.js';
import { issuePath } from '../store/issues.js';
import { diagnoseProject, grepIssues, listIssues, projectLockState, showIssue } from './read.js';
import type { Session } from './session.js';
import {
  addComponent, addIssue, closeIssueBy, commentOn, listComponents, parseEdit, readForEdit,
  removeComponent, saveEdited, setFields,
} from './write.js';
import { openProject } from './index.js';
import { shortId as renderShortId } from '../render/human.js';
import { applyFilter as filterApplyFilter, matchIssues } from './filter.js';
import * as api from './index.js';

let tmp: string;
let s: Session;

const ENV = { DZ_AUTHOR: 'Test User <test@example.com>' };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-api-'));
  initProject(tmp, 'demo');
  saveConfig(tmp, { name: 'demo', components: ['core'] });
  s = { root: tmp, env: ENV };
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('reads', () => {
  it('lists nothing in a fresh project, and reports no failures', () => {
    expect(listIssues(s)).toEqual({ issues: [], failures: [] });
  });

  it('reports unreadable files rather than hiding them', () => {
    fs.writeFileSync(path.join(tmp, 'dz', 'issues', 'junk.md'), 'not an issue\n');
    const { issues, failures } = listIssues(s);
    expect(issues).toEqual([]);
    expect(failures).toHaveLength(1);
  });

  it('rejects a filter value outside the vocabulary', () => {
    expect(() => listIssues(s, { status: 'nope' })).toThrow(DzError);
  });

  it('reports an invalid regex as a user error, not a crash', () => {
    try {
      grepIssues(s, '(');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('INVALID_FIELD');
    }
  });

  it('raises NOT_FOUND for an id prefix that matches nothing', () => {
    try {
      showIssue(s, 'ffffffff');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('NOT_FOUND');
    }
  });
});

describe('writes', () => {
  function anIssue(title = 'A title'): string {
    return addIssue(s, { title, type: 'task' }).id;
  }

  it('creates an issue and reads it back', () => {
    const id = anIssue('written through the facade');
    expect(listIssues(s).issues.map((i) => i.title)).toEqual(['written through the facade']);
    expect(showIssue(s, id.slice(0, 13)).title).toBe('written through the facade');
  });

  it('changes several fields in one call', () => {
    const id = anIssue();
    const updated = setFields(s, id.slice(0, 13), {
      title: 'Renamed', type: 'bug', component: 'core', status: 'in-progress',
    });
    expect(updated.title).toBe('Renamed');
    expect(updated.type).toBe('bug');
    expect(updated.component).toBe('core');
    expect(updated.status).toBe('in-progress');
  });

  it('clears a field with null rather than an empty string', () => {
    const id = anIssue();
    setFields(s, id.slice(0, 13), { assignee: 'someone' });
    expect(setFields(s, id.slice(0, 13), { assignee: null }).assignee).toBeNull();
  });

  it('refuses a set with no fields', () => {
    const id = anIssue();
    try {
      setFields(s, id.slice(0, 13), {});
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('INVALID_FIELD');
    }
  });

  it('refuses a component that is not configured', () => {
    try {
      addIssue(s, { title: 'x', type: 'task', component: 'nope' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('INVALID_FIELD');
    }
  });

  it('appends a comment', () => {
    const id = anIssue();
    const after = commentOn(s, id.slice(0, 13), 'a remark');
    expect(JSON.stringify(after.log)).toContain('a remark');
  });

  it('closes with a resolution and refuses an unknown one', () => {
    const id = anIssue();
    expect(closeIssueBy(s, id.slice(0, 13), 'fixed').status).toBe('closed');
    const other = anIssue('another');
    try {
      closeIssueBy(s, other.slice(0, 13), 'abandoned');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('INVALID_FIELD');
    }
  });

  it('releases the lock after every write, so the next one succeeds', () => {
    const id = anIssue();
    commentOn(s, id.slice(0, 13), 'one');
    commentOn(s, id.slice(0, 13), 'two');
    expect(fs.existsSync(path.join(tmp, 'dz', '.lock'))).toBe(false);
  });

  it('fails immediately with LOCKED when lockTimeoutMs is 0 and a lock is held', () => {
    const id = anIssue();
    // A foreign, live-looking lock: this host, this pid, so it reads as active.
    fs.writeFileSync(path.join(tmp, 'dz', '.lock'), JSON.stringify({
      version: 1, token: 'held', pid: process.pid,
      hostname: os.hostname(),
      created: new Date().toISOString(), command: 'comment',
    }));
    const impatient: Session = { root: tmp, env: ENV, lockTimeoutMs: 0 };
    const started = Date.now();
    try {
      commentOn(impatient, id.slice(0, 13), 'blocked');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('LOCKED');
    }
    // The whole point of lockTimeoutMs: 0 for a UI — no synchronous sleep.
    expect(Date.now() - started).toBeLessThan(150);
  });
});

describe('components, doctor and the lock', () => {
  it('adds a component idempotently and keeps the list sorted', () => {
    expect(addComponent(s, 'zeta')).toEqual({ components: ['core', 'zeta'], added: true });
    expect(addComponent(s, 'alpha'))
      .toEqual({ components: ['alpha', 'core', 'zeta'], added: true });
    // Re-adding reports added: false, which is what lets the CLI word its
    // message without a second, unlocked read.
    expect(addComponent(s, 'alpha'))
      .toEqual({ components: ['alpha', 'core', 'zeta'], added: false });
  });

  it('refuses an empty component name', () => {
    expect(() => addComponent(s, '   ')).toThrow(DzError);
  });

  it('refuses to remove a component that does not exist', () => {
    try {
      removeComponent(s, 'ghost');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('NOT_FOUND');
    }
  });

  it('refuses to remove a component in use, unless forced', () => {
    addIssue(s, { title: 'uses core', type: 'task', component: 'core' });
    try {
      removeComponent(s, 'core');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('INVALID_FIELD');
    }
    expect(removeComponent(s, 'core', true)).toEqual([]);
  });

  it('reports a healthy project as having no problems', () => {
    expect(diagnoseProject(s)).toEqual([]);
  });

  it('reports the gitignore problem doctor exists to catch', () => {
    fs.rmSync(path.join(tmp, 'dz', '.gitignore'));
    expect(diagnoseProject(s).map((p) => p.code)).toContain('GITIGNORE_MISSING');
  });

  it('reports no lock on a quiet project', () => {
    expect(projectLockState(s).kind).toBe('none');
  });
});

describe('saveEdited', () => {
  function fileFor(id: string): string {
    return issuePath(tmp, id);
  }

  it('writes when the file still matches the baseline', () => {
    const id = addIssue(s, { title: 'Original', type: 'task' }).id;
    const baseline = fs.readFileSync(fileFor(id), 'utf8');
    const edited = parseIssue(baseline.replace('title: Original', 'title: Edited'), 'scratch');

    const r = saveEdited(s, edited, baseline);

    expect(r.saved).toBe(true);
    expect(showIssue(s, id.slice(0, 13)).title).toBe('Edited');
  });

  it('refuses and hands back the current bytes when someone else wrote first', () => {
    const id = addIssue(s, { title: 'Original', type: 'task' }).id;
    const baseline = fs.readFileSync(fileFor(id), 'utf8');
    const edited = parseIssue(baseline.replace('title: Original', 'title: Mine'), 'scratch');

    // Another writer lands while the editor is open.
    setFields(s, id.slice(0, 13), { title: 'Theirs' });

    const r = saveEdited(s, edited, baseline);

    expect(r.saved).toBe(false);
    if (r.saved) return;
    expect(r.current).toContain('title: Theirs');
    // Nothing was overwritten.
    expect(showIssue(s, id.slice(0, 13)).title).toBe('Theirs');
  });

  it('lets a second attempt against the newer bytes succeed, which is what forcing is', () => {
    const id = addIssue(s, { title: 'Original', type: 'task' }).id;
    const baseline = fs.readFileSync(fileFor(id), 'utf8');
    const edited = parseIssue(baseline.replace('title: Original', 'title: Mine'), 'scratch');
    setFields(s, id.slice(0, 13), { title: 'Theirs' });

    const first = saveEdited(s, edited, baseline);
    expect(first.saved).toBe(false);
    if (first.saved) return;

    const second = saveEdited(s, edited, first.current as string);

    expect(second.saved).toBe(true);
    expect(showIssue(s, id.slice(0, 13)).title).toBe('Mine');
  });

  it('recreates a file that was deleted, given the null baseline the conflict reported', () => {
    const id = addIssue(s, { title: 'Original', type: 'task' }).id;
    const baseline = fs.readFileSync(fileFor(id), 'utf8');
    const edited = parseIssue(baseline.replace('title: Original', 'title: Mine'), 'scratch');
    fs.rmSync(fileFor(id));

    const first = saveEdited(s, edited, baseline);
    expect(first.saved).toBe(false);
    if (first.saved) return;
    // A deleted file has to be expressible as a baseline, or forcing over one
    // is a comparison that can never succeed.
    expect(first.current).toBeNull();

    expect(saveEdited(s, edited, first.current).saved).toBe(true);
    expect(showIssue(s, id.slice(0, 13)).title).toBe('Mine');
  });

  it('still refuses an issue that validation rejects', () => {
    const id = addIssue(s, { title: 'Original', type: 'task' }).id;
    const baseline = fs.readFileSync(fileFor(id), 'utf8');
    const bad = parseIssue(baseline.replace('title: Original', 'title: ""'), 'scratch');
    expect(() => saveEdited(s, bad, baseline)).toThrow(DzError);
    expect(showIssue(s, id.slice(0, 13)).title).toBe('Original');
  });
});

describe('readForEdit and parseEdit', () => {
  it('hands back bytes that saveEdited accepts as a baseline', () => {
    const id = addIssue(s, { title: 'Original', type: 'task' }).id;

    const { issue, baseline } = readForEdit(s, id.slice(0, 13));

    expect(issue.id).toBe(id);
    // The whole point: nothing else in the closed surface can produce this.
    expect(baseline).toBe(fs.readFileSync(issuePath(tmp, id), 'utf8'));

    const edited = parseEdit(s, baseline.replace('title: Original', 'title: Edited'), issue);
    expect(saveEdited(s, edited, baseline).saved).toBe(true);
    expect(showIssue(s, id.slice(0, 13)).title).toBe('Edited');
  });

  it('refuses an edit that changes the id, which would overwrite another issue', () => {
    const mine = addIssue(s, { title: 'Mine', type: 'task' });
    const other = addIssue(s, { title: 'Other', type: 'task' });
    const { issue, baseline } = readForEdit(s, mine.id.slice(0, 13));

    try {
      parseEdit(s, baseline.replace(`id: ${mine.id}`, `id: ${other.id}`), issue);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('INVALID_FIELD');
      expect((err as DzError).message).toContain('the id may not be changed by an edit');
    }
    expect(showIssue(s, other.id.slice(0, 13)).title).toBe('Other');
  });

  it('does not let a write landing between two reads split issue from baseline', () => {
    const id = addIssue(s, { title: 'Original', type: 'task' }).id;
    const file = issuePath(tmp, id);
    const before = fs.readFileSync(file, 'utf8');
    const after = before.replace('title: Original', 'title: Concurrent');

    // Stands in for a writer landing right after readForEdit looks at the
    // file. mockImplementationOnce fires on the *first* fs.readFileSync call
    // readForEdit makes; a correct, single-read readForEdit never makes a
    // second one, so the injected write below is never observed by it. The
    // old two-read shape (`findIssue` for `issue`, then a second
    // `readFileSync` for `baseline`) would have its second, un-mocked read
    // see `after` — pairing a stale `issue` (parsed from `before`) with a
    // fresh `baseline` (`after`), which is exactly the split this method
    // exists to prevent.
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
      fs.writeFileSync(file, after, 'utf8');
      return before;
    });
    let issue; let baseline;
    try {
      ({ issue, baseline } = readForEdit(s, id.slice(0, 13)));
    } finally {
      spy.mockRestore();
    }

    // The whole point: `issue` is exactly what parsing `baseline` produces,
    // never a mix of two different reads.
    expect(issue).toEqual(parseIssue(baseline));
  });

  it('refuses an edit whose component is not configured', () => {
    const mine = addIssue(s, { title: 'Mine', type: 'task' });
    const { issue, baseline } = readForEdit(s, mine.id.slice(0, 13));

    try {
      parseEdit(s, baseline.replace('component: null', 'component: nope'), issue);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('INVALID_FIELD');
      expect((err as DzError).message).toContain('nope');
    }
  });
});

describe('openProject', () => {
  it('exposes the whole surface bound to one project', () => {
    const p = openProject(tmp, { env: ENV });
    expect(p.root).toBe(tmp);

    const created = p.add({ title: 'via openProject', type: 'bug' });
    expect(p.list().issues.map((i) => i.title)).toEqual(['via openProject']);
    expect(p.show(created.id.slice(0, 13)).type).toBe('bug');
    expect(p.grep('openProject').issues).toHaveLength(1);
    expect(p.set(created.id.slice(0, 13), { title: 'renamed' }).title).toBe('renamed');
    expect(p.comment(created.id.slice(0, 13), 'hi').log.length).toBeGreaterThan(1);
    expect(p.close(created.id.slice(0, 13), 'fixed').status).toBe('closed');

    expect(p.components.list()).toEqual(['core']);
    expect(p.components.add('extra')).toEqual({ components: ['core', 'extra'], added: true });
    expect(p.components.remove('extra')).toEqual(['core']);

    expect(p.doctor()).toEqual([]);
    expect(p.lock.state().kind).toBe('none');

    const { issue, baseline } = p.readForEdit(created.id.slice(0, 13));
    const edited = p.parseEdit(baseline.replace('title: renamed', 'title: edited'), issue);
    expect(p.saveEdited(edited, baseline).saved).toBe(true);
    expect(p.show(created.id.slice(0, 13)).title).toBe('edited');

    fs.writeFileSync(path.join(tmp, 'dz', '.lock'), JSON.stringify({
      version: 1, token: 'stale', pid: process.pid,
      hostname: os.hostname(),
      created: new Date().toISOString(), command: 'edit',
    }));
    expect(p.lock.break('stale')).toBe(true);
    expect(p.lock.state().kind).toBe('none');
  });

  it('fails at open time when there is no project', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-empty-'));
    try {
      openProject(empty, { env: ENV });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('NO_PROJECT');
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('passes lockTimeoutMs through to the operations', () => {
    fs.writeFileSync(path.join(tmp, 'dz', '.lock'), JSON.stringify({
      version: 1, token: 'held', pid: process.pid,
      hostname: os.hostname(),
      created: new Date().toISOString(), command: 'set',
    }));
    const p = openProject(tmp, { env: ENV, lockTimeoutMs: 0 });
    const started = Date.now();
    expect(() => p.add({ title: 'blocked', type: 'task' })).toThrow(DzError);
    expect(Date.now() - started).toBeLessThan(150);
  });
});

describe('the surface a UI reads', () => {
  it('exports the very same shortId the CLI renders with', () => {
    // Not "produces the same output" — the same function. Two copies of the
    // 13-char rule would drift, and dz doctor already paid for that lesson.
    expect(api.shortId).toBe(renderShortId);
    expect(api.applyFilter).toBe(filterApplyFilter);
  });

  it('matches issues in memory by the same rule grep uses', () => {
    addIssue(s, { title: 'tokenizer drops a newline', type: 'bug' });
    addIssue(s, { title: 'unrelated', type: 'task' });
    const { issues } = listIssues(s);
    expect(matchIssues(issues, 'tokeni').map((i) => i.title))
      .toEqual(['tokenizer drops a newline']);
  });

  it('searches log text in memory, not just titles and bodies', () => {
    const issue = addIssue(s, { title: 'quiet', type: 'task' });
    commentOn(s, issue.id, 'the culprit is the lexer');
    const { issues } = listIssues(s);
    expect(matchIssues(issues, 'lexer')).toHaveLength(1);
  });

  it('agrees with grepIssues on the same project', () => {
    addIssue(s, { title: 'tokenizer drops a newline', type: 'bug' });
    addIssue(s, { title: 'unrelated', type: 'task' });
    const viaDisk = grepIssues(s, 'tokeni').issues.map((i) => i.id);
    const viaMemory = matchIssues(listIssues(s).issues, 'tokeni').map((i) => i.id);
    expect(viaMemory).toEqual(viaDisk);
  });

  it('reports an invalid regex the same way grep does', () => {
    expect(() => matchIssues([], '(')).toThrow(DzError);
  });

  it('names the project without a second read of config.yaml by the caller', () => {
    expect(openProject(tmp, { env: ENV }).name).toBe('demo');
  });

  it('reports who the author is, and null when there is none', () => {
    expect(openProject(tmp, { env: ENV }).whoami())
      .toBe('Test User <test@example.com>');
    // Browsing must work in a project with no identity configured, so this is
    // null rather than the throw resolveAuthor raises for a write.
    expect(openProject(tmp, { env: {} }).whoami()).toBeNull();
  });
});
