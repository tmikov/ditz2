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
import { DzError } from '../core/errors.js';
import { parseIssue } from '../core/serialize.js';
import type { Issue } from '../core/types.js';
import { validateEnum, validateIssue } from '../core/validate.js';
import { shortId } from '../render/human.js';
import { renderIssueJson } from '../render/json.js';
import { loadConfig } from '../store/config.js';
import { findIssue, issuePath, writeIssue } from '../store/issues.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';
import { withProjectLock } from './lock.js';
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
      const target = issuePath(root, findIssue(root, prefix).id);
      const rel = path.relative(root, target);

      // Outside dz/issues on purpose: a *.md file there is read as an issue.
      // Never renamed into place, so a different filesystem is fine.
      const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-edit-'));
      const scratch = path.join(scratchDir, path.basename(target));

      /**
       * The bytes the scratch file was derived from. A write is safe only
       * while the file on disk still matches this; `reload` moves it forward.
       */
      let baseline = fs.readFileSync(target, 'utf8');
      const originalId = parseIssue(baseline, rel).id;
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

      /** Parses and checks the scratch file, reporting failures against it. */
      const readEdited = (): Issue => {
        try {
          // Named as the scratch, not the target: the content being parsed here
          // is what the user just saved to the scratch file.
          const issue = parseIssue(fs.readFileSync(scratch, 'utf8'), scratch);
          // writeIssue picks its destination from issue.id, and parseIssue does
          // not check the id against the filename — only readIssue does, and
          // this path bypasses it. A changed id would leave the original alone,
          // create a second issue, and silently overwrite any issue using it.
          if (issue.id !== originalId) {
            throw new DzError(
              'INVALID_FIELD',
              `the id may not be changed by an edit: it was "${originalId}" and is now `
              + `"${issue.id}". Ids are identity; there is no rename operation.`,
            );
          }
          validateIssue(issue, loadConfig(root));
          return issue;
        } catch (err) {
          if (!(err instanceof DzError)) throw err;
          throw new DzError(
            err.code,
            `${err.message}. The issue was not changed; your edit is at ${scratch}`,
          );
        }
      };

      /** Writes under the lock, or reports why not. Never partially applies. */
      const commit = (issue: Issue): void => {
        try {
          // Re-validate under the lock. The check in readEdited ran against the
          // config as it was when the editor opened, and a session can last
          // hours — long enough for `component rm --force` to invalidate this
          // issue. The write-side guard in writeIssue only checks that the
          // bytes re-parse, not that the invariants hold.
          validateIssue(issue, loadConfig(root));
          writeIssue(root, issue);
        } catch (err) {
          // Only a DzError is a judgement about the user's edit. An ENOSPC or
          // EACCES from the write is a fault in the machine, and relabelling it
          // used to produce `error.code: "ENOSPC"` — exit 1, and a code that is
          // not in the published schema's enum. Let those through as-is so the
          // top level reports them as internal errors with exit 3.
          if (!(err instanceof DzError)) throw err;
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

          // The conflicting bytes, set by the locked section below when the
          // file on disk no longer matches what the edit was based on.
          let conflict: string | null = null;
          withProjectLock(ctx, root, 'edit', () => {
            // Compare exact bytes: another writer may have changed the issue
            // while the editor was open, and overwriting discards their work.
            const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
            if (current === baseline) {
              commit(edited);
              return;
            }
            conflict = current;
          });
          if (conflict === null) return edited;

          // Deliberately outside the lock: whatever happens next waits on a
          // human, and holding the lock across that blocks every other writer.
          for (;;) {
            const action = decide();
            if (action === 'abort') throw aborted();

            if (action === 'reload') {
              const kept = setAside('your-edit', fs.readFileSync(scratch, 'utf8'));
              fs.writeFileSync(scratch, conflict as unknown as string, 'utf8');
              baseline = conflict as unknown as string;
              ctx.stderr.write(`your version was kept at ${kept}\n`);
              break; // reopen the editor on the fresh content
            }

            // Force. Reacquire and confirm the file is still the version the
            // operator was told about; it can change again while they read the
            // prompt. If it did, ask again rather than overwrite something
            // nobody has seen.
            let raced = false;
            let wrote = false;
            withProjectLock(ctx, root, 'edit', () => {
              const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
              if (current !== conflict) {
                conflict = current;
                raced = true;
                return;
              }
              // edit appends no log entry, so without this the overwritten
              // version leaves no trace that it ever existed.
              if (current !== null) {
                ctx.stderr.write(
                  `the version you overwrote was kept at ${setAside('overwritten', current)}\n`,
                );
              }
              commit(edited);
              wrote = true;
            });
            if (wrote) return edited;
            if (raced) continue; // re-ask against the newer conflict
          }
        }
      })();

      fs.rmSync(scratchDir, { recursive: true, force: true });
      ctx.stdout.write(ctx.json ? renderIssueJson(issue) : `edited ${shortId(issue.id)}\n`);
    });
}
