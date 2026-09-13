/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ptySpawn, shq } from '../pty.js';

/**
 * The linked `dz`, checked as something a stranger received rather than as
 * something this checkout produced.
 *
 * Gated on `$DZ_DIST`, which `npm run hermes:dist` sets to the executable it
 * just linked. That is narrower than the `$HERMES_NODE` gate the rest of
 * tests/hermes/ uses, and deliberately: these run exactly when there is an
 * executable to run them against, so `npm test` never needs one and a plain
 * `npm run hermes` is not slowed by a link it did not ask for.
 *
 * Everything here runs with HERMES_NODE stripped from the environment. A
 * binary that only works because a hermes-node happens to be on the machine
 * is not the artifact this phase exists to produce.
 */
const DZ = process.env.DZ_DIST ?? '';
const HBB = DZ === '' ? '' : path.join(path.dirname(DZ), 'dz.hbb');

/** The caller's environment minus the runtime, plus an identity to write with. */
function env(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...process.env, DZ_AUTHOR: 'Test User <test@example.com>' };
  delete out.HERMES_NODE;
  return out;
}

/**
 * A throwaway project with the binary beside it, never inside it.
 *
 * The executable is named `dz` and the project directory it creates is also
 * named `dz`, so a binary sitting in the directory it is asked to initialise
 * collides with its own output — `ENOTDIR ... mkdir 'dz/issues'`. Found the
 * first time this was run by hand, and worth the two directories here so that
 * a future reader does not rediscover it as a bug in the binary.
 */
function scratch(): { root: string; bin: string; proj: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-dist-'));
  const bin = path.join(root, 'bin', 'dz');
  const proj = path.join(root, 'proj');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.mkdirSync(proj, { recursive: true });
  fs.copyFileSync(DZ, bin);
  fs.chmodSync(bin, 0o755);
  return { root, bin, proj };
}

function run(bin: string, args: string[], cwd: string): string {
  return execFileSync(bin, args, { cwd, encoding: 'utf8', env: env() });
}

/** `--dump` on the container, read with the runtime rather than the binary. */
function dump(): string {
  const hermes = process.env.HERMES_NODE;
  if (hermes === undefined || hermes === '') {
    throw new Error('reading the container needs $HERMES_NODE as well as $DZ_DIST');
  }
  return execFileSync(hermes, [`--bundle=${HBB}`, '--dump'], { encoding: 'utf8' });
}

describe.skipIf(!process.env.DZ_DIST)('the container dz was linked from', () => {
  it('holds the terminal UI', () => {
    // The failure this whole phase exists to avoid: a binary that builds, runs
    // `dz list`, and answers `dz ui` with "the terminal UI is a separate
    // package". The scanner only finds ditz2-ui because src/cli/ui.ts spells
    // the specifier literally; revert that one line and this count is zero.
    expect(dump()).toMatch(/ditz2-ui/);
  });

  it('has the WebAssembly baked in', () => {
    // Ink loads yoga's Wasm as its module graph loads, so an unbaked container
    // recompiles ~257KB at every launch. `WASM (0)` is what dropping
    // --bake-wasm looks like, and it is invisible from the outside except as
    // slow startup.
    const modules = /^WASM \((\d+)\)/m.exec(dump());
    expect(modules).not.toBeNull();
    expect(Number(modules?.[1])).toBeGreaterThan(0);
  });
});

describe.skipIf(!process.env.DZ_DIST)('the linked dz, on its own', () => {
  it('initialises, adds, lists and shows with no node_modules and no runtime', () => {
    const { root, bin, proj } = scratch();
    try {
      run(bin, ['init', '--name', 'demo'], proj);
      expect(fs.existsSync(path.join(proj, 'dz', 'config.yaml'))).toBe(true);

      const added = run(bin, ['add', 'a packaged issue', '--type', 'task'], proj);
      const id = added.trim().split(/\s+/)[1];
      expect(id).toMatch(/^[0-9a-f-]{13}$/);
      expect(run(bin, ['list'], proj)).toContain('a packaged issue');
      expect(run(bin, ['show', id], proj)).toContain('a packaged issue');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps working when the checkout that built it is gone', () => {
    // The difference between a bundle and a binary, and the only check that
    // measures it. Everything above would pass just as happily against an
    // executable that still reached back into build-hermes/ for its modules.
    //
    // It renames a tree that run.test.ts's launcher also reads, so the two
    // files must not run concurrently: `npm run hermes:dist` passes
    // --no-file-parallelism for exactly this reason. Running
    // `vitest run tests/hermes` by hand with $DZ_DIST set and without that
    // flag makes run.test.ts fail on a missing staging tree, which looks like
    // a broken launcher and is not.
    const { root, bin, proj } = scratch();
    const staging = path.resolve(path.dirname(DZ), '..');
    const moved = `${staging}.hidden-for-test`;
    try {
      run(bin, ['init', '--name', 'demo'], proj);
      run(bin, ['add', 'survives the staging tree', '--type', 'task'], proj);

      fs.renameSync(staging, moved);
      try {
        expect(fs.existsSync(staging)).toBe(false);
        expect(run(bin, ['list'], proj)).toContain('survives the staging tree');
      } finally {
        fs.renameSync(moved, staging);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

interface UiRun { out: string; sawFrame: boolean; code: number | null }

describe.skipIf(!process.env.DZ_DIST)('dz ui inside the linked dz', () => {
  it('renders a frame and exits 0 when q is pressed', async () => {
    const { root, bin, proj } = scratch();
    try {
      run(bin, ['init', '--name', 'demo'], proj);
      run(bin, ['add', 'visible in the packaged ui', '--type', 'task'], proj);

      const e = { ...env(), TERM: 'xterm-256color', COLUMNS: '100', LINES: '30' };
      const { file, args } = ptySpawn(`${shq(bin)} ui`, { cols: '100', rows: '30' });

      const r = await new Promise<UiRun>((resolve) => {
        const child = spawn(file, args, { cwd: proj, env: e });
        let out = '';
        let sawFrame = false;
        const kill = setTimeout(() => { child.kill('SIGKILL'); }, 25_000);
        child.stdout?.on('data', (d: Buffer) => {
          out += d.toString();
          if (sawFrame || !out.includes('visible in the packaged ui')) return;
          sawFrame = true;
          // Keyed off the frame rather than a timer, and EOF goes separately
          // and later — the same two rules run.test.ts settled on, for the
          // same BSD `script` EOT reason documented there.
          child.stdin?.write('q');
          setTimeout(() => { child.stdin?.end(); }, 500);
        });
        child.stderr?.on('data', (d: Buffer) => { out += d.toString(); });
        child.on('exit', (code) => { clearTimeout(kill); resolve({ out, sawFrame, code }); });
      });

      expect(r.sawFrame).toBe(true);
      // The install hint is what a container missing ditz2-ui prints instead
      // of a frame, so its absence is asserted rather than left to sawFrame.
      expect(r.out).not.toContain('separate package');
      expect(r.code).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 40_000);
});
