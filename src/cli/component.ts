/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';
import { addComponent, listComponents, removeComponent } from '../api/write.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';

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
      const components = listComponents({ root: findProjectRoot(ctx.cwd), env: ctx.env });
      report(ctx, components, listing(components));
    });

  component
    .command('add')
    .description('add a component')
    .argument('<name>')
    .action((name: string) => {
      const { components, added } = addComponent(
        { root: findProjectRoot(ctx.cwd), env: ctx.env },
        name,
      );
      const trimmed = name.trim();
      report(
        ctx,
        components,
        added
          ? `added component "${trimmed}"\n`
          : `component "${trimmed}" is already configured\n`,
      );
    });

  component
    .command('rm')
    .description('remove a component')
    .argument('<name>')
    .option('--force', 'remove it even though issues still use it')
    .action((name: string, opts: { force?: boolean }) => {
      const components = removeComponent(
        { root: findProjectRoot(ctx.cwd), env: ctx.env },
        name,
        opts.force === true,
      );
      report(ctx, components, `removed component "${name}"\n`);
    });
}
