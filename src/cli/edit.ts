/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Command } from 'commander';
import { parseEdit, readForEdit, saveEdited, type SaveResult } from '../api/write.js';
import { DzError } from '../core/errors.js';
import type { Issue } from '../core/types.js';
import { validateEnum } from '../core/validate.js';
import { shortId } from '../render/human.js';
import { renderIssueJson } from '../render/json.js';
import { issuePath } from '../store/issues.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';
import { canPrompt, choose } from './prompt.js';

/** POSIX single-quoting, so a path containing spaces survives `shell: true`. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** What to do when the issue changed while the editor was open. */
type OnConflict = 'reload' | 'force' | 'abort';

const CONFLICT_CHOICES = ['abort', 'force'] as const;

export function registerEdit(program: Command, ctx: CliContext): void {
  program
    .command('edit')
    .description('open an issue in $EDITOR')
    .argument('<id-prefix>')
    .option(
      '--on-conflict <action>',
      `what to do if the issue changed while the editor was open: ${CONFLICT_CHOICES.join(' or ')}. `
      + 'Without this, an interactive terminal is asked and anything else aborts',
    )
    .action((prefix: string, opts: { onConflict?: string }) => {
      const editor = ctx.env['VISUAL'] ?? ctx.env['EDITOR'] ?? '';
      if (editor.trim() === '') {
        throw new DzError('INVALID_FIELD', 'no editor configured; set EDITOR or VISUAL');
      }

      // `reload` is deliberately not accepted here: reloading means reopening
      // the editor, which a caller that passed a non-interactive policy is by
      // definition not in a position to do.
      const preset = opts.onConflict === undefined
        ? undefined
        : validateEnum(opts.onConflict, CONFLICT_CHOICES, 'on-conflict');

      const root = findProjectRoot(ctx.cwd);
      const session = { root, env: ctx.env };
      const source = readForEdit(session, prefix);
      const original = source.issue;
      const target = issuePath(root, original.id);
      const rel = path.relative(root, target);

      // Outside dz/issues on purpose: a *.md file there is read as an issue.
      // Never renamed into place, so a different filesystem is fine.
      const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-edit-'));
      const scratch = path.join(scratchDir, path.basename(target));

      /**
       * The bytes the scratch file was derived from. A write is safe only
       * while the file on disk still matches this; `reload` moves it forward.
       */
      let baseline: string | null = source.baseline;
      fs.writeFileSync(scratch, baseline, 'utf8');

      /** Keeps a copy that would otherwise be lost, and returns where. */
      let asideCount = 0;
      const setAside = (what: string, contents: string): string => {
        asideCount += 1;
        const kept = path.join(
          fs.mkdtempSync(path.join(os.tmpdir(), 'dz-edit-kept-')),
          `${what}-${asideCount}-${path.basename(target)}`,
        );
        fs.writeFileSync(kept, contents, 'utf8');
        return kept;
      };

      const runEditor = (): void => {
        // No lock is held here. An editing session can last hours.
        const result = spawnSync(`${editor} ${shellQuote(scratch)}`, {
          stdio: 'inherit',
          shell: true,
        });
        if (result.status !== 0) {
          throw new DzError(
            'INVALID_FIELD',
            `editor exited with status ${String(result.status)}; your edit is at ${scratch}`,
          );
        }
      };

      /** parseEdit, with failures pointed back at the scratch file. */
      const readEdited = (): Issue => {
        try {
          return parseEdit(session, fs.readFileSync(scratch, 'utf8'), original);
        } catch (err) {
          if (!(err instanceof DzError)) throw err;
          throw new DzError(
            err.code,
            `${err.message}. The issue was not changed; your edit is at ${scratch}`,
          );
        }
      };

      /** saveEdited, with failures pointed back at the scratch file. */
      const save = (issue: Issue, base: string | null): SaveResult => {
        try {
          return saveEdited(session, issue, base);
        } catch (err) {
          // A validation failure here is a judgement about the user's edit, so
          // it must name the scratch file — their work is on disk and nothing
          // else would tell them where. LOCKED is not about the edit and is
          // rethrown untouched, or every contended save would claim the issue
          // was invalid.
          if (!(err instanceof DzError) || err.code === 'LOCKED') throw err;
          throw new DzError(
            err.code,
            `${err.message}. The issue was not changed; your edit is at ${scratch}`,
          );
        }
      };

      const decide = (): OnConflict => {
        if (preset !== undefined) return preset;
        if (!canPrompt(ctx)) return 'abort';
        return choose<OnConflict>(
          ctx,
          `${rel} changed while your editor was open.`,
          [
            { key: 'r', label: 'eload it and edit again', value: 'reload' },
            { key: 'f', label: 'orce your version over it', value: 'force' },
            { key: 'a', label: 'bort', value: 'abort' },
          ],
          // End of input is a refusal to answer, so take the option that
          // destroys nothing.
        ) ?? 'abort';
      };

      const aborted = (): DzError => new DzError(
        'CONCURRENT_MODIFICATION',
        `${rel} was modified while your editor was open, so it was left alone. `
        + `Your edit is at ${scratch}; merge it by hand.`,
      );

      const issue = ((): Issue => {
        for (;;) {
          runEditor();
          const edited = readEdited();

          const first = save(edited, baseline);
          if (first.saved) return first.issue;
          let conflict: string | null = first.current;

          // Deliberately outside the lock: whatever happens next waits on a
          // human, and holding the lock across that blocks every other writer.
          for (;;) {
            const action = decide();
            if (action === 'abort') throw aborted();

            if (action === 'reload') {
              const kept = setAside('your-edit', fs.readFileSync(scratch, 'utf8'));
              fs.writeFileSync(scratch, conflict ?? '', 'utf8');
              baseline = conflict;
              ctx.stderr.write(`your version was kept at ${kept}\n`);
              break; // reopen the editor on the fresh content
            }

            // Force is the same compare-and-swap against the bytes the operator
            // was actually shown. If the file moved on again, ask again rather
            // than overwrite something nobody has seen.
            const forced = save(edited, conflict);
            if (forced.saved) {
              // Announced only after the write succeeded. Saying "the version
              // you overwrote" before knowing whether anything was overwritten
              // is a lie on a double race, where the save is refused and the
              // operator is re-prompted.
              if (conflict !== null) {
                ctx.stderr.write(
                  `the version you overwrote was kept at ${setAside('overwritten', conflict)}\n`,
                );
              }
              return forced.issue;
            }
            conflict = forced.current;
          }
        }
      })();

      fs.rmSync(scratchDir, { recursive: true, force: true });
      ctx.stdout.write(ctx.json ? renderIssueJson(issue) : `edited ${shortId(issue.id)}\n`);
    });
}
