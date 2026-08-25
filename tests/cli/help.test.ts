/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { dz, withTempProject } from '../helpers.js';

/**
 * Command names commander lists under "Commands:" in `dz --help`.
 *
 * Commander indents a command name by exactly two spaces and aligns wrapped
 * description text much further right, so the `(?! )` guard is what keeps a
 * wrapped description (e.g. help's own "...(tutorial, agents)") from being
 * mistaken for a command.
 */
function registeredCommands(dir: string): string[] {
  const help = dz(['--help'], { cwd: dir }).stdout;
  const body = help.slice(help.indexOf('Commands:') + 'Commands:'.length);
  return body
    .split('\n')
    .map((line) => /^ {2}(?! )([a-z][a-z-]*)\b/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
}

describe('dz help <topic>', () => {
  it('prints the tutorial', () => {
    withTempProject((dir) => {
      const r = dz(['help', 'tutorial'], { cwd: dir });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('dz init --name myproject');
      expect(r.stdout).toContain('dz close 01a03150 --as fixed');
      expect(r.stderr).toBe('');
    });
  });

  it('prints the agent contract', () => {
    withTempProject((dir) => {
      const r = dz(['help', 'agents'], { cwd: dir });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('{"error":{"code","message"}}');
      expect(r.stdout).toContain("'set --status closed' is rejected");
      expect(r.stdout).toContain('DZ_AUTHOR');
    });
  });

  it('works outside a project, since it reads no files', () => {
    withTempProject((dir) => {
      // No `dz init` here: help must not require a dz/ directory.
      expect(dz(['help', 'agents'], { cwd: dir }).code).toBe(0);
    });
  });

  it('still delegates to commander for a command name', () => {
    withTempProject((dir) => {
      // Regression guard: defining our own `help` command shadows commander's
      // built-in `dz help <command>`. Without explicit delegation this prints
      // "no help topic" instead of add's usage.
      const r = dz(['help', 'add'], { cwd: dir });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('Usage: dz add');
      expect(r.stdout).toContain('--type');
      expect(r.stdout).not.toContain('no help topic');
    });
  });

  it('prints the program help with no topic', () => {
    withTempProject((dir) => {
      const r = dz(['help'], { cwd: dir });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('Usage: dz');
    });
  });

  it('rejects an unknown topic and names the valid ones', () => {
    withTempProject((dir) => {
      const r = dz(['help', 'bogus', '--json'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      const err = JSON.parse(r.stderr).error;
      expect(err.code).toBe('INVALID_FIELD');
      expect(err.message).toContain('tutorial');
      expect(err.message).toContain('agents');
    });
  });

  it('is discoverable from dz --help', () => {
    withTempProject((dir) => {
      const help = dz(['--help'], { cwd: dir }).stdout;
      expect(help).toContain('dz help tutorial');
      expect(help).toContain('dz help agents');
    });
  });
});

describe('help text does not drift from the real command set', () => {
  it('mentions every registered command in the tutorial', () => {
    withTempProject((dir) => {
      const tutorial = dz(['help', 'tutorial'], { cwd: dir }).stdout;
      // `help` documents itself in the trailer, not as a tutorial step.
      const expected = registeredCommands(dir).filter((c) => c !== 'help');
      expect(expected.length).toBeGreaterThan(5);
      for (const name of expected) {
        // Anchored to a tutorial step line, so a passing mention in the prose
        // trailer does not count as documenting the command.
        const step = new RegExp(String.raw`^ {2}dz ${name}\b`, 'm');
        expect(step.test(tutorial), `tutorial has no \`dz ${name}\` step`).toBe(true);
      }
    });
  });

  it('mentions no command in the tutorial that does not exist', () => {
    withTempProject((dir) => {
      const tutorial = dz(['help', 'tutorial'], { cwd: dir }).stdout;
      const known = new Set(registeredCommands(dir));
      const used = [...tutorial.matchAll(/^ {2}dz ([a-z][a-z-]*)/gm)].map((m) => m[1]);
      expect(used.length).toBeGreaterThan(5);
      for (const name of used) {
        expect(known.has(name), `tutorial documents \`dz ${name}\`, which is not a command`)
          .toBe(true);
      }
    });
  });
});
