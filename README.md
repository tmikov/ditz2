# ditz2

`ditz2` is a command line issue tracker that keeps your issues inside your project's repository,
as files, next to the code they describe. You file and close bugs with `dz`, from the terminal
you already have open. There is nothing running in the background and nothing to log into: the
whole tracker is a directory of Markdown files you can read with `cat` and edit by hand.

If you have used GitHub Issues or Jira, the difference is where the data lives. Those keep your
issues in someone else's system and give you a browser tab. ditz2 writes one file per issue into
a `dz/` directory in your project, and you commit those files along with everything else.

It is a successor to [ditz](https://github.com/jashmenn/ditz), William Morgan's 2008 tracker,
which had the same idea; this is a fresh implementation in Node.js and TypeScript. You do not
need to know anything about the original to use this one.

## Install and build

Requires **Node >= 20**. This is a hard floor, not a preference: ditz2 uses `uuid@11` for
UUIDv7 ids, and that package requires the global `crypto` object, which is not available in
Node 18's ESM runtime. The unit tests won't catch a downgrade — they run under Vitest, which
polyfills it — but the built binary will crash on `dz add`.

```bash
cd ditz2          # from a checkout of this repository
npm install
npm run build
npm link          # puts `dz` on your PATH, or run dist/cli/main.js directly
```

`dz` is not published to npm, so there is no `npm install -g ditz2`; build it from a checkout.

## Worked example

```bash
$ dz init --name demo
initialized dz project "demo" in /path/to/demo/dz
author identity: Jane Doe <jane@example.com>   # probed from your VCS config

$ dz add "Parser drops trailing newline" --type bug -m 'repro here'
created 01a03150-be20  Parser drops trailing newline

$ dz list
01a03150-be20  open         bug      Parser drops trailing newline

$ dz set 01a03150-be20 --status in-progress
updated 01a03150-be20

$ dz close 01a03150-be20 --as fixed
closed 01a03150-be20 (fixed)

$ dz show 01a03150-be20
01a03150-be20  Parser drops trailing newline
  id         01a03150-be20-751a-bda5-36cca1bfcdd8
  type       bug
  status     closed (fixed)
  component  (none)
  assignee   (none)
  created    2026-08-24T01:09:30.272Z
  creator    Jane Doe <jane@example.com>

repro here

Log:
  2026-08-24T01:09:30.272Z  Jane Doe <jane@example.com>  created
  2026-08-24T01:09:30.886Z  Jane Doe <jane@example.com>  status: open -> in-progress
  2026-08-24T01:09:31.123Z  Jane Doe <jane@example.com>  status: in-progress -> closed (fixed)
```

Note that the closed issue no longer appears in `dz list`: closed issues are hidden unless you
pass `--all` or ask for them with `--status closed`.

`<id-prefix>` in every command is any unambiguous leading substring of the issue's UUID; an
ambiguous prefix is an error that lists the matching candidates with their titles.

The three commands that take a message — `add`, `comment`, and `close` — also accept `-m -` in
place of `-m <text>` to read it from stdin, so they work in a pipeline.

## On-disk layout

```
<project root>/
  dz/
    .gitignore             two lines: config.local.yaml, .lock
    config.yaml            project name + component list   (committed)
    config.local.yaml      author identity                 (ignored)
    issues/
      0198f2a1-6b41-7c3d-9e02-1f4a8c5d3b77.md
      0198f2b0-9d17-7a55-8c31-6e2b0f9a4d12.md
```

`dz/config.yaml` is the project root marker; every command walks up from the current directory
until it finds one. The directory is named `dz/`, not `.dz/`, so issues stay browsable on a
forge and greppable without special flags.

Each issue is one Markdown file: YAML frontmatter, a free-form body, and an append-only `## Log`
section recording every change with its timestamp and author. You can read and edit these files
by hand. `dz edit <id-prefix>` opens `$EDITOR` on a scratch copy and validates it on exit: the
real file is replaced only if the edit parses and validates, and otherwise it is left alone and
your version stays in the scratch file, whose path is printed. See [Concurrency](#concurrency).

The body is free-form Markdown and ditz2 does not reformat its content, but it is not preserved
byte for byte. Leading and trailing blank lines are trimmed, which is what lets a file survive a
parse-and-render cycle unchanged. A body line reading exactly `## Log` starts the log section, so
it cannot appear in the body. And because the frontmatter is re-emitted from the parsed values,
comments and formatting inside it do not survive a rewrite.

Log comment text is indented four spaces under its entry. A blank line inside a comment is
written blank, and read back as content because an indented line follows it; a blank line that
nothing follows is separation between entries. So a comment cannot begin or end with a blank
line — `dz` trims a message either way — and nothing dz writes carries trailing whitespace.
Files written by earlier versions spelled an in-comment blank line as four spaces; those still
read correctly, and `dz doctor --fix` cleans them up.

Issue ids are UUIDv7, so filenames sort chronologically. The short id printed by every command is
the first 13 characters of the UUID — long enough to stay unique across issues created in
different milliseconds — and any unambiguous prefix of it works as `<id-prefix>` input, so you
can usually type even fewer characters.

## Working with git

Issues are files in your repository, so git already knows what to do with them. There is nothing
to sync and no second tool in the loop. ditz2 itself never runs git; it only reads and writes
files, and you commit them however you normally would.

Closing an issue is just a file edit, which means it can ride along in the same commit as the
fix. `git show` on that commit then gives you the patch and the reason for it in one place.

Issues branch. Open one on a feature branch and it exists only there until you merge, which is
handy while the work is still speculative. Status changes show up in code review as part of the
diff, so a reviewer can push back on them.

None of this needs a network connection, so the tracker is as available as your checkout. It
works the same under other version control systems, and does not break in a plain tarball with no VCS at
all: ditz2 shells out to a version control system exactly once, during `dz init`, to guess your
name and email.

### Merging

The original ditz kept a global `project.yaml` index that every new issue touched, so two people
filing bugs at the same time conflicted every time. That is a good part of why it never caught on.

ditz2 has no global index. One file per issue, named by a UUID nobody has to coordinate, so two
people working on different issues never write to the same file. Editing the *same* issue on two
branches can still conflict, and you resolve that in an editor like any other conflict. If a file
with conflict markers in it does get committed, ditz2 recognizes them and says so, rather than
failing with a confusing YAML parse error.

### What you give up

No web UI, no notifications, no cross repository queries, and no permissions beyond who can push
to the repo. If your team is happy in GitHub Issues, this will feel like a downgrade. ditz2 suits
projects where the issue list is small enough to read, and where you would rather keep it in the
repo than in a browser tab.

## Identity

Every log entry needs an author. ditz2 resolves it in this order:

1. The `DZ_AUTHOR` environment variable, e.g. `Jane Doe <jane@example.com>` — wins so CI and
   agents can set it inline.
2. `author: ...` in `dz/config.local.yaml`, written automatically by `dz init` if it can probe
   your VCS identity.
3. Otherwise, every command that needs an author fails with an error naming both of the above.

Whichever source it comes from, the author string may not contain a line break or a double
space: the log format uses those to separate entries and fields, so an author containing one
would corrupt the entry it appears in. Single spaces, as in `Name <email>`, are fine.

## Concurrency

Commands that modify the project take a single lock at `dz/.lock`, so two running at once
cannot lose each other's changes. Read-only commands — `list`, `show`, `grep`, `doctor`,
`schema`, `help` — never take it, and never wait. `dz doctor --fix` does write, so that form
takes the lock like any other mutation.

On contention a command retries briefly and then fails with `LOCKED`. Set `DZ_LOCK_TIMEOUT_MS`
to change how long it waits; `0` fails immediately, which is what you want if you are
implementing your own retry policy.

`dz edit` is the exception: it copies the issue to a scratch file, runs your editor with no
lock held, and takes the lock only to check that nobody else changed the issue and to write
the result.

If someone did change it, what happens next depends on where you are. On a terminal `dz edit`
asks, offering to reload the newer version and edit again, force your version over it, or
abort. Reloading keeps your discarded attempt in a file and prints the path; forcing does the
same for the version it overwrites, since `edit` writes no log entry and there would otherwise
be no record it existed. Anywhere else — a pipe, a script, an agent, or `--json` — it does not
ask, because there may be nobody to answer: it fails with `CONCURRENT_MODIFICATION` and leaves
everything alone. Pass `--on-conflict abort|force` to decide in advance.

If a command is killed outright, the lock can be left behind. `dz doctor` reports it and
`dz unlock` removes it — refusing while the owning process is still alive, and requiring
`--force` for a lock from another machine, which cannot be judged from here.

The lock only serializes `dz` against itself. It does not make a concurrent `git commit`
atomic: a commit taken while an agent is working captures whole, valid issue files, but not
necessarily a coherent moment. It can never capture a half-written file, because every write
is a temp file plus a rename.

## `--json` and exit codes

Every command accepts `--json`, which switches stdout to a machine-readable payload — a single
issue object, an array of issues, or the result of `init`. The exception is `dz help`, whose
output is prose whether or not you pass the flag. In `--json` mode, errors are written
to **stderr** as `{"error":{"code":"...","message":"..."}}` and stdout is left empty, so an agent
can parse stdout unconditionally on success.

| Exit code | Meaning | `code` values |
|---|---|---|
| `0` | success | — |
| `1` | user error | `NO_PROJECT`, `NOT_FOUND`, `AMBIGUOUS_PREFIX`, `INVALID_FIELD`, `PARSE_ERROR`, `CONFLICT_MARKERS`, `LOCKED`, `CONCURRENT_MODIFICATION` |
| `2` | usage error (bad flags or arguments) | `USAGE_ERROR` |
| `3` | internal error | `INTERNAL` |

Under `--json`, stderr is either empty or exactly one JSON object. It carries an `error` key, a
`warnings` key, or both, so parse it whole rather than line by line.

A malformed issue file never fails `list` or `grep` outright: the bad file is skipped, the good
results still go to stdout, and the command exits `1` at the end. One bad file cannot hide the
rest. The skipped files are named on stderr — as `dz: warning: skipping ...` normally, or under
`--json` as:

```json
{"warnings":[{"file":"dz/issues/0198f2a1-….md","code":"CONFLICT_MARKERS","message":"…"}]}
```

The per-file `code` is worth branching on: `CONFLICT_MARKERS` means go finish a merge, while
`PARSE_ERROR` means the file itself is malformed.

## Commands

```
dz init   [--name <name>]
dz add    "<title>" [--type bug|feature|task] [--component <c>] [-m <text>]
dz list   [--status <s>] [--component <c>] [--assignee <a>] [--type <t>] [--all]
dz show   <id-prefix>
dz set    <id-prefix> [--status <s>] [--title <t>] [--component <c>] [--assignee <a>] [--type <t>]
dz comment <id-prefix> -m "<text>"
dz close  <id-prefix> --as <fixed|wontfix|duplicate> [-m "<text>"]
dz edit   <id-prefix> [--on-conflict <abort|force>]
dz grep   <regex> [<list filters>]
dz doctor [--fix]
dz unlock [--force]
dz component list | add <name> | rm <name> [--force]
dz schema
dz help   [<command> | tutorial | agents]
```

`dz component` manages the list in `dz/config.yaml`. A new project has none, and `--component`
rejects every value until you add one. `add` is idempotent; `rm` refuses while issues still use
the component, naming them, unless you pass `--force` — after which `dz doctor` reports those
issues, since they cannot be modified until their component is changed.

`dz schema` prints a JSON Schema covering every `--json` payload. The schema document is
versioned rather than the payloads: `dz list --json` is a bare array, so an in-band version field
would mean wrapping it and breaking every existing caller. A test validates real command output
against the schema, which is what keeps the two from drifting apart.

`dz doctor` checks the project for problems nothing else reports: a missing or emptied
`dz/.gitignore` (which would let your identity file be committed, so anyone who clones authors
their log entries as you), a `config.yaml` whose contents are being silently ignored, issues
naming a component you have since removed, unparseable issue files, temp files left by an
interrupted write, and issue files carrying trailing whitespace. It prints a remedy for each and
exits `1` if it found any.

It diagnoses; it does not repair. A malformed issue file is your data, and guessing at a fix
could destroy something the tool cannot reconstruct, so every remedy is prose for you to act on.

The single exception is `dz doctor --fix`, which strips trailing whitespace from issue files.
It is safe to automate because it is not a guess: each file is parsed before and after, and
rewritten only if the two parse to an identical issue. Where the whitespace follows real text —
two trailing spaces are a markdown line break — that check fails, so `--fix` reports the file
and leaves it alone. Versions before this one wrote a blank line inside a log comment as four
spaces, which is what put trailing whitespace in existing projects.

Note: `dz init` starts a project with an empty component list, so `--component` on `add`/`set`
rejects every value until you run `dz component add <name>`.

### A terminal UI

`dz ui` opens a full-screen view of the backlog: browse and filter it, and write
to it — comment, close, edit an issue's fields, create one. The keys are listed
in [ui/README.md](ui/README.md#keys) rather than here: this file is outside that
package, and an enumeration a plan has no reason to look at is one that goes
stale. It lives in a separate package so that the CLI keeps its three
dependencies — Ink and React are 38 packages and about 23 MB.

Its writes go through the same public API as the CLI's, so they take the same
lock and get the same validation. It passes `lockTimeoutMs: 0` for the reason
described below, and shows contention as a screen you can retry from rather than
as a two-second freeze.

Neither package is published yet; see [ui/README.md](ui/README.md) for how to
build and run it from a clone.

## Using ditz2 from Node

`ditz2` publishes a small synchronous API alongside the `dz` command. It is the
same code the CLI runs, so anything you can do here you can do at the command
line and vice versa.

```js
import { openProject } from 'ditz2';

const dz = openProject(process.cwd(), { env: process.env });

for (const issue of dz.list({ status: 'open' }).issues) {
  console.log(issue.id, issue.title);
}

dz.set('01a031ea', { status: 'in-progress', assignee: 'me@example.com' });
```

Only this entry point is public. `dz/`'s internals — the store, the parser, the
renderers — are not importable and change without notice.

Every method is synchronous, and mutating ones take the project lock for the
duration of their read-modify-write. Pass `lockTimeoutMs: 0` if you would
rather handle contention yourself than have the call sleep: it then throws a
`LOCKED` error immediately instead of waiting. A long-running UI should always
do this, because a synchronous wait blocks its event loop.

## License

MIT. Copyright (c) 2026 Tzvetan Mikov. See [LICENSE](LICENSE) for the full text; every
source file carries a short header pointing back to it.
