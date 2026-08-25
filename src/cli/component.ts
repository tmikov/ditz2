/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';
import { DzError } from '../core/errors.js';
import { loadConfig, saveConfig } from '../store/config.js';
import { loadAllIssues } from '../store/issues.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';
import { withProjectLock } from './lock.js';

function report(ctx: CliContext, components: string[], humanLine: string): void {
  ctx.stdout.write(
    ctx.json ? `${JSON.stringify({ components }, null, 2)}\n` : humanLine,
  );
}

function listing(components: string[]): string {
  return components.length === 0
    ? 'no components configured\n'
    : `${components.join('\n')}\n`;
}

export function registerComponent(program: Command, ctx: CliContext): void {
  const component = program
    .command('component')
    .description('manage the component list in dz/config.yaml');

  component
    .command('list')
    .description('list the configured components')
    .action(() => {
      const config = loadConfig(findProjectRoot(ctx.cwd));
      report(ctx, config.components, listing(config.components));
    });

  component
    .command('add')
    .description('add a component')
    .argument('<name>')
    .action((name: string) => {
      const trimmed = name.trim();
      if (trimmed === '') {
        throw new DzError('INVALID_FIELD', 'a component name cannot be empty');
      }

      const root = findProjectRoot(ctx.cwd);
      withProjectLock(ctx, root, 'component add', () => {
        const config = loadConfig(root);
        if (config.components.includes(trimmed)) {
          // Idempotent: re-adding is what a script or an agent does on a rerun,
          // and failing there would be noise rather than information.
          report(ctx, config.components, `component "${trimmed}" is already configured\n`);
          return;
        }

        const components = [...config.components, trimmed].sort();
        saveConfig(root, { ...config, components });
        report(ctx, components, `added component "${trimmed}"\n`);
      });
    });

  component
    .command('rm')
    .description('remove a component')
    .argument('<name>')
    .option('--force', 'remove it even though issues still use it')
    .action((name: string, opts: { force?: boolean }) => {
      const root = findProjectRoot(ctx.cwd);
      withProjectLock(ctx, root, 'component rm', () => {
        const config = loadConfig(root);

        // Removing something that is not there is almost always a typo, so it
        // is an error rather than a silent success. `add` is the idempotent one.
        if (!config.components.includes(name)) {
          throw new DzError(
            'NOT_FOUND',
            config.components.length === 0
              ? `no component "${name}"; dz/config.yaml lists no components yet`
              : `no component "${name}"; dz/config.yaml lists ${config.components.join(', ')}`,
          );
        }

        // Removing a component in use is what creates issues that cannot be
        // modified afterwards, which `dz doctor` then reports. Say so first.
        const inUse = loadAllIssues(root).issues.filter((i) => i.component === name);
        if (inUse.length > 0 && opts.force !== true) {
          const ids = inUse.map((i) => `  ${i.id}  ${i.title}`).join('\n');
          throw new DzError(
            'INVALID_FIELD',
            `${inUse.length === 1 ? '1 issue still uses' : `${inUse.length} issues still use`} component "${name}":\n${ids}\n`
            + `reassign them with 'dz set --component', or pass --force to remove it anyway. `
            + `Forcing leaves those issues unmodifiable until their component is changed; 'dz doctor' will report them.`,
          );
        }

        const components = config.components.filter((c) => c !== name);
        saveConfig(root, { ...config, components });
        report(ctx, components, `removed component "${name}"\n`);
      });
    });
}
