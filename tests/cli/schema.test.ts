/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// The default ajv export is draft-07; the schema declares 2020-12. Named
// import, because the default export is not constructable under NodeNext.
import { Ajv2020 } from 'ajv/dist/2020.js';
import { isIsoTimestamp } from '../../src/core/clock.js';
import { dz, withTempProject } from '../helpers.js';

/**
 * Validates real command output against the published schema. The schema file
 * on its own is a promise; this is what keeps it true.
 */
const ajv = new Ajv2020({ strict: false, allErrors: true });
// Without this ajv silently ignores `format`, so every `date-time` in the
// schema was unchecked and the timestamp assertions below proved nothing.
// Same predicate the tool validates with, so the two cannot disagree.
ajv.addFormat('date-time', (v: string) => isIsoTimestamp(v));
const schema = JSON.parse(dz(['schema'], { cwd: process.cwd() }).stdout);
ajv.addSchema(schema, 'dz');

function check(def: string, value: unknown): void {
  const validate = ajv.getSchema(`dz#/$defs/${def}`);
  if (validate === undefined) throw new Error(`no such $def: ${def}`);
  const ok = validate(value);
  expect(ok, `${def}: ${ajv.errorsText(validate.errors, { separator: '\n  ' })}`).toBe(true);
}

function project<T>(fn: (dir: string) => T): T {
  return withTempProject((dir) => {
    dz(['init', '--name', 'demo'], { cwd: dir });
    dz(['component', 'add', 'core'], { cwd: dir });
    return fn(dir);
  });
}

describe('dz schema', () => {
  it('prints a parseable, versioned JSON Schema', () => {
    expect(schema.$schema).toContain('json-schema.org');
    expect(schema.schemaVersion).toBe(1);
    expect(schema.$id).toContain('v1');
  });

  it('is itself a valid schema, so a consumer can actually compile it', () => {
    expect(ajv.validateSchema(schema)).toBe(true);
  });

  it('needs no --json, since it is already JSON', () => {
    const r = dz(['schema'], { cwd: process.cwd() });
    expect(r.code).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });
});

describe('real output validates against the schema', () => {
  it('init', () => {
    withTempProject((dir) => {
      check('initResult', JSON.parse(dz(['init', '--name', 'x', '--json'], { cwd: dir }).stdout));
    });
  });

  it('a single issue, from add and from show', () => {
    project((dir) => {
      const added = JSON.parse(
        dz(['add', 'a bug', '--type', 'bug', '--component', 'core', '-m', 'body', '--json'],
          { cwd: dir }).stdout,
      );
      check('issue', added);
      check('issue', JSON.parse(dz(['show', added.id, '--json'], { cwd: dir }).stdout));
    });
  });

  it('an issue that has been through every mutation', () => {
    project((dir) => {
      const id = JSON.parse(dz(['add', 'churned', '--json'], { cwd: dir }).stdout).id;
      dz(['set', id, '--status', 'in-progress', '--assignee', 'a@b.c'], { cwd: dir });
      dz(['comment', id, '-m', 'multi\nline'], { cwd: dir });
      dz(['close', id, '--as', 'fixed', '-m', 'done'], { cwd: dir });
      check('issue', JSON.parse(dz(['show', id, '--json'], { cwd: dir }).stdout));
    });
  });

  it('list and grep', () => {
    project((dir) => {
      dz(['add', 'one', '--json'], { cwd: dir });
      dz(['add', 'two', '--json'], { cwd: dir });
      check('issueList', JSON.parse(dz(['list', '--json'], { cwd: dir }).stdout));
      check('issueList', JSON.parse(dz(['grep', 'o', '--json'], { cwd: dir }).stdout));
    });
  });

  it('the error envelope', () => {
    project((dir) => {
      check('errorEnvelope', JSON.parse(dz(['show', 'ffffffff', '--json'], { cwd: dir }).stderr));
    });
  });

  it('the error envelope for a usage error, whose code differs', () => {
    project((dir) => {
      check('errorEnvelope', JSON.parse(dz(['bogus', '--json'], { cwd: dir }).stderr));
    });
  });

  it('the warnings envelope', () => {
    project((dir) => {
      dz(['add', 'good', '--json'], { cwd: dir });
      fs.writeFileSync(path.join(dir, 'dz', 'issues', 'bad.md'), 'garbage\n');
      check('warningsEnvelope', JSON.parse(dz(['list', '--json'], { cwd: dir }).stderr));
    });
  });

  it('doctor, healthy and unhealthy', () => {
    project((dir) => {
      check('doctorReport', JSON.parse(dz(['doctor', '--json'], { cwd: dir }).stdout));
      fs.rmSync(path.join(dir, 'dz', '.gitignore'));
      check('doctorReport', JSON.parse(dz(['doctor', '--json'], { cwd: dir }).stdout));
    });
  });

  it('component list', () => {
    project((dir) => {
      check('componentList', JSON.parse(dz(['component', 'list', '--json'], { cwd: dir }).stdout));
    });
  });

  it('unlock, with and without a lock to remove', () => {
    project((dir) => {
      check('unlockResult', JSON.parse(dz(['unlock', '--json'], { cwd: dir }).stdout));

      fs.writeFileSync(path.join(dir, 'dz', '.lock'), JSON.stringify({
        version: 1,
        token: 'tok',
        pid: 2147483000, // a pid this host cannot have, so the lock reads as abandoned
        hostname: os.hostname(),
        created: new Date().toISOString(),
        command: 'set',
      }));
      check('unlockResult', JSON.parse(dz(['unlock', '--json'], { cwd: dir }).stdout));
    });
  });
});

describe('the schema is strict enough to catch drift', () => {
  it('rejects an issue with an unexpected extra field', () => {
    project((dir) => {
      const issue = JSON.parse(dz(['add', 'x', '--json'], { cwd: dir }).stdout);
      const validate = ajv.getSchema('dz#/$defs/issue');
      // additionalProperties: false is what makes a silently-added field a
      // test failure rather than something a consumer discovers in production.
      expect(validate?.({ ...issue, surprise: 1 })).toBe(false);
    });
  });

  it('rejects an issue missing a required field', () => {
    project((dir) => {
      const issue = JSON.parse(dz(['add', 'x', '--json'], { cwd: dir }).stdout);
      delete issue.log;
      expect(ajv.getSchema('dz#/$defs/issue')?.(issue)).toBe(false);
    });
  });
});
