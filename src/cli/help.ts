/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';
import { DzError } from '../core/errors.js';
import type { CliContext } from './context.js';

const TUTORIAL = `dz tutorial — one session, in order.

  dz init --name myproject
      Creates dz/ here. Probes your VCS for your name and email and
      saves it to dz/config.local.yaml, which is gitignored.

  dz add "Parser drops trailing newline" --type bug -m "repro goes here"
      Files an issue and prints its short id. --type is bug, feature or task
      (default task). Use any unambiguous prefix of that id from here on.

  dz list
      Open issues, oldest first. Closed ones are hidden until you ask with
      --all or --status closed. Also filters on --type, --component, --assignee.

  dz show 01a03150
      Everything about one issue: fields, body, and the full change log.

  dz set 01a03150 --status in-progress --assignee jane@example.com
      Changes fields. --status takes open or in-progress; closing needs a
      resolution, so it has its own command.

  dz comment 01a03150 -m "It is the tokenizer, not the parser."
      Appends a comment to the log. Use -m - to read it from stdin.

  dz close 01a03150 --as fixed
      Closes with a resolution: fixed, wontfix or duplicate.

  dz grep tokenizer
      Regex over titles, bodies and comments. Takes the same filters as list.

  dz edit 01a03150
      Opens a scratch copy of the raw Markdown file in $EDITOR and checks it
      on exit. The real file is replaced only if the edit parses and validates;
      if it does not, dz says so and prints where your version is waiting.
      If someone else changed the issue meanwhile, a terminal is asked whether
      to reload, force or abort; anything else aborts. --on-conflict decides
      in advance.

  dz component add cli
      Adds a component. A new project has none, and --component rejects any
      value until you add one. Also 'component list' and 'component rm'.

  dz doctor [--fix]
      Checks the project for problems nothing else reports: a missing
      dz/.gitignore, a broken config.yaml, issues naming a component you have
      since removed. It only reports; every remedy is prose for you to act on.
      The exception is --fix, which strips trailing whitespace from issue
      files, and only where the result parses to an identical issue.

  dz unlock
      Removes a project lock left behind by a command that died mid-write.
      Refuses a live lock, and refuses one it cannot judge (wrong hostname,
      unreadable metadata) unless you pass --force, which can delete a lock a
      running command still holds. 'dz doctor' points here when it finds one.

  dz schema
      Prints the JSON Schema for every --json payload.

  dz ui
      Opens a full-screen terminal UI for browsing the backlog, if the separate
      ditz2-ui package is installed. It needs a terminal, and everything it can
      do the commands above can already do.

Then commit dz/ along with your code. Every command also accepts --json.
Run 'dz help agents' for the machine-readable contract.
`;

const AGENTS = `dz agents — operating notes for programmatic use.

CONTRACT
  Every command accepts --json.
  Success: JSON on stdout, nothing on stderr.
  Failure: nothing on stdout, {"error":{"code","message"}} on stderr.
  Partial: results on stdout AND {"warnings":[...]} on stderr, exit 1.
  Under --json, stderr is either empty or exactly ONE json object, carrying
      an "error" key, a "warnings" key, or both. Parse it whole; do not split
      it into lines.
  So when the exit code is 0 you may parse stdout unconditionally.
  Exceptions: 'dz help' output is prose, never JSON, and 'dz ui' is
      interactive and rejects --json with INVALID_FIELD.

EXIT CODES
  0  success
  1  user error    codes: NO_PROJECT, NOT_FOUND, AMBIGUOUS_PREFIX,
                          INVALID_FIELD, PARSE_ERROR, CONFLICT_MARKERS,
                          LOCKED, CONCURRENT_MODIFICATION
  2  usage error   bad flags or arguments; code USAGE_ERROR
  3  internal error; code INTERNAL

GOTCHAS
  'set --status closed' is rejected. Use 'close --as fixed|wontfix|duplicate'.
  'list' hides closed issues. Pass --all, or --status closed.
  --component rejects every value until components exist, and 'dz init' starts
      that list empty. Add them with 'dz component add <name>'.
  -m - reads the message from stdin. Works on add, comment and close.
  <id-prefix> is any unambiguous leading substring of an issue id. Ambiguity
      is an error that lists the candidates, so prefer the id you were given.
  A malformed issue file does not fail 'list' or 'grep': the bad file is
      skipped, the good results still go to stdout, and the command exits 1
      with {"warnings":[{"file","code","message"}]} on stderr. The per-file
      code matters: CONFLICT_MARKERS means finish the merge, PARSE_ERROR means
      the file is malformed.
  Mutating commands take a project lock. On contention they retry for
      DZ_LOCK_TIMEOUT_MS (default 2000, 0 fails immediately) and then fail with
      code LOCKED. Read-only commands never wait.
  'dz edit' holds no lock while the editor is open, and holds none while it
      asks you about a conflict either. On a terminal it offers to reload the
      newer version, force yours over it, or abort. Without a terminal, or
      under --json, it does not ask: it fails with CONCURRENT_MODIFICATION and
      changes nothing. --on-conflict abort|force chooses without being asked.
      Whatever is discarded is written to a file whose path is printed.

SCHEMA
  'dz schema' prints a JSON Schema covering every payload below, versioned as
      a document rather than by a field inside each payload: 'dz list --json'
      is a bare array, so an in-band version would mean wrapping it and
      breaking existing callers. Validate against it if you parse strictly.

WHEN SOMETHING LOOKS WRONG
  'dz doctor' reports project-level problems with a remedy for each, exits 1
      if it found any, and emits {"problems":[{"code","file","message",
      "remedy"}]} under --json. It edits nothing without --fix, so it is safe
      to run first when a command fails for a reason you did not expect.
      'dz doctor --fix' takes the lock, strips trailing whitespace from issue
      files where doing so provably changes no content, and adds a "fixed"
      array to the --json payload. The exit code still reflects what remains.

IDENTITY
  Every mutation records an author. If 'dz init' could not probe one, set
  DZ_AUTHOR="Name <email>". It may not contain a newline or a double space,
  because the log format uses those as separators.

TYPICAL SEQUENCE
  id=$(dz add "title" --type bug --json | jq -r .id)
  dz set "$id" --status in-progress --json
  dz comment "$id" -m - --json < note.txt
  dz close "$id" --as fixed --json
`;

/** Prose help topics, keyed by the name passed to \`dz help <topic>\`. */
export const HELP_TOPICS: Readonly<Record<string, string>> = {
  tutorial: TUTORIAL,
  agents: AGENTS,
};

export function registerHelp(program: Command, ctx: CliContext): void {
  program
    .command('help')
    .description(`show help for a command, or a topic (${Object.keys(HELP_TOPICS).join(', ')})`)
    .argument('[topic]', 'a command name, or a help topic')
    .action((topic: string | undefined) => {
      if (topic === undefined) {
        program.outputHelp();
        return;
      }

      const text = HELP_TOPICS[topic];
      if (text !== undefined) {
        ctx.stdout.write(text);
        return;
      }

      // Defining our own `help` command shadows commander's built-in
      // `dz help <command>`, so that has to be re-implemented by hand here.
      // Without this, `dz help add` would report "no help topic".
      const command = program.commands.find((c) => c.name() === topic);
      if (command !== undefined) {
        command.outputHelp();
        return;
      }

      throw new DzError(
        'INVALID_FIELD',
        `no help topic "${topic}"; expected a command name, or one of: ${Object.keys(HELP_TOPICS).join(', ')}`,
      );
    });

  program.addHelpText(
    'after',
    `\nRun 'dz help tutorial' for a worked example, or 'dz help agents' if you are a program.`,
  );
}
