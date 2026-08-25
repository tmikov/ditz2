# ditz2 — Design (v1)

**Date:** 2026-08-22
**Status:** Approved for implementation planning

## 1. Overview

`ditz2` is a spiritual successor to [ditz](https://github.com/jashmenn/ditz), William Morgan's
2008 distributed issue tracker. It keeps ditz's defining idea — issues are plain files living in
the project repository, versioned and branched alongside the code by whatever VCS is already in
use — and modernizes the implementation in Node.js + TypeScript.

No server. No database. No network. An issue tracker you can `cat`.

### Target consumers

All three are first-class in v1, which is why `--json` and merge behavior are v1 concerns rather
than later additions:

- **A human at a terminal.** Terse commands, readable output, an `$EDITOR` escape hatch.
- **AI coding agents.** Every command supports `--json`; no command requires a TTY or an
  interactive prompt.
- **A small team sharing a repo.** Concurrent edits across branches must merge sanely. Merge
  friction is what killed the original.

### Non-goals for v1

- Releases / milestones. Deferred; see §10.
- A TUI. Deferred to v2; see §10.
- Any network or server component. Permanently out of scope.
- Syncing with GitHub Issues, Jira, Phabricator, or similar.

## 2. Design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Storage | One Markdown file per issue | Readable and editable without the tool; line-based diffs; no global index to conflict on |
| Ids | UUIDv7 | Collision-free across branches with no coordination; time-ordered, so directory listing is chronological and date ranges are prefix scans |
| Concepts | Issues, components, append-only event log | Components are explicit rather than tags — grouping is a distinct concept from labelling |
| Status | `open` / `in-progress` / `closed` + resolution | Fixed vocabulary the tool can validate; drops ditz's `paused`, which was indistinguishable from `open` plus a comment |
| VCS coupling | Agnostic, except an identity probe at `init` | Works in a tarball, a worktree, or no repo at all |
| Mutation verbs | A single orthogonal `set` | No `start`/`stop`/`assign` aliases. Deliberate; trivially added later |

### Storage: alternatives considered

**Event-sourced (append-only JSONL per issue, state derived by replay).** Nearly conflict-free
merges, since concurrent changes are two appends a merge driver can union. Rejected for v1: it
loses the property that makes the format pleasant — you cannot read or edit an issue without the
tool, and `grep` over the issue directory stops being useful.

**Hybrid (append-only log is authoritative, Markdown document is a regenerated cache).** The
correct end state at team scale. Rejected for v1: it doubles the file count and introduces a
cache-consistency invariant that needs a `repair` command to police.

The chosen design keeps the hybrid reachable. Because the Markdown file already carries a
structured event log, promoting that log to authoritative and demoting the frontmatter to derived
requires no change to the file format or the CLI surface.

The merge pain that killed ditz came predominantly from its global `project.yaml` index, which
every issue creation touched. Without a global index, per-issue conflicts are rare enough that
machinery to prevent them does not earn its place in v1.

## 3. Architecture

Four layers. The governing rule: **exactly one layer touches the filesystem.**

```
cli/        commander command definitions, one file per command.
            Parses argv, calls core/store, hands the result to render.
            Never touches fs. Never formats output.

render/     Pure functions: Issue[] -> human text, Issue[] -> JSON.
            Both output modes render from the same in-memory value,
            so they cannot drift apart.

core/       Domain logic. No I/O of any kind.
  issue.ts       Issue type, status transitions, field validation
  id.ts          UUIDv7 generation, prefix resolution
  serialize.ts   Issue <-> Markdown string. Pure.
  errors.ts      DzError and its codes

store/      The only module that touches disk: project root discovery,
            read/write/list issue files, config load/save, atomic writes.
```

Two properties matter beyond tidiness:

**`serialize.ts` is pure `string <-> Issue`.** Every edge case of the file format is testable with
no filesystem setup, which is where the majority of format bugs live.

**`core` and `store` never print and never call `process.exit`.** They return values and throw
typed errors. This is what makes a TUI (§10) a parallel consumer rather than a rewrite.

Writes are atomic: serialize to a temp file in the same directory, then `rename`. A crash mid-write
cannot truncate an issue.

## 4. On-disk layout

```
<project root>/
  dz/
    .gitignore             one line: config.local.yaml
    config.yaml            project name + component list   (committed)
    config.local.yaml      author identity                 (ignored)
    issues/
      0198f2a1-6b41-7c3d-9e02-1f4a8c5d3b77.md
      0198f2b0-9d17-7a55-8c31-6e2b0f9a4d12.md
```

`dz/config.yaml` is the root marker; commands walk up from `cwd` until they find it. The directory
is visible rather than `.dz/` so issues stay browsable on a forge and greppable without `rg -uu`.

### Identity and .gitignore

`init` writes `dz/.gitignore` containing `config.local.yaml`, unconditionally. A nested
`.gitignore` is self-contained: it never modifies a file outside `dz/`, it is idempotent, it works
correctly when the project sits inside a monorepo whose root is far above, and both git and
the local VCS honor it. Writing it unconditionally avoids VCS detection entirely, and the file is inert
outside a repository.

Author identity resolves in this order:

1. `DZ_AUTHOR` environment variable — wins so CI and agents can set it inline
2. `dz/config.local.yaml`, written by `init`
3. Error, naming both of the above

At `init`, identity is probed once from `git config user.name` / `user.email`, falling back to the
the local VCS equivalent, and written to `config.local.yaml`. This probe is the only place in the entire
tool that shells out to a VCS. If both probes fail, `init` still succeeds and reports that
`DZ_AUTHOR` must be set.

### Issue file format

```markdown
---
id: 0198f2b0-9d17-7a55-8c31-6e2b0f9a4d12
title: Parser drops trailing newline
type: bug
status: in-progress
resolution: null
component: core
assignee: tmikov@example.com
created: 2026-08-22T09:14:03.221Z
creator: Tzvetan Mikov <tmikov@example.com>
---

Repro: feed the tokenizer a file with no final newline and the last
token is silently dropped.

## Log

- 2026-08-22T09:14:03.221Z  Tzvetan Mikov <tmikov@example.com>  created
- 2026-08-22T11:02:55.010Z  Tzvetan Mikov <tmikov@example.com>  status: open -> in-progress
- 2026-08-22T11:40:12.887Z  Tzvetan Mikov <tmikov@example.com>  comment
    Turns out it's the tokenizer, not the parser.
```

Three regions, in fixed order:

1. **Frontmatter** — YAML between the leading `---` fences.
2. **Body** — everything from the closing fence up to the `## Log` heading. Free-form Markdown,
   preserved verbatim; the tool never reformats it. A `---` inside the body is body text, not a
   fence, because only the leading fence pair is significant.
3. **Log** — everything after the `## Log` heading.

Log grammar, strict enough to round-trip:

```
entry       := "- " timestamp "  " author "  " verb [": " detail] "\n" continuation*
continuation:= "    " text "\n"
timestamp   := ISO 8601, milliseconds, UTC
author      := display form of the identity, e.g. "Tzvetan Mikov <tmikov@example.com>"
verb        := created | comment | status | assigned | component | title | type
```

Fields are separated by exactly two spaces, and the parser splits on the first two two-space runs
only. An author may therefore contain single spaces, as `Name <email>` does.

Closing is logged as a `status` entry whose detail names the resolution:
`status: in-progress -> closed (fixed)`. There is no separate `closed` verb; every status
transition uses one form, so a consumer reconstructing history reads one verb rather than two.

Continuation lines carry comment bodies. A four-space indent distinguishes them from the next
entry unambiguously.

`status` in the frontmatter is the source of truth in v1; the log records how it got there, and
the tool maintains both. §2 describes how this seam later inverts.

### config.yaml

```yaml
name: ditz2
components:
  - core
  - cli
  - docs
```

## 5. Data model

```ts
type Status = 'open' | 'in-progress' | 'closed';
type Resolution = 'fixed' | 'wontfix' | 'duplicate';
type IssueType = 'bug' | 'feature' | 'task';

interface LogEntry {
  timestamp: string;   // ISO 8601
  author: string;
  verb: string;
  detail: string | null;
  text: string | null; // continuation lines, for comments
}

interface Issue {
  id: string;                      // UUIDv7
  title: string;
  type: IssueType;
  status: Status;
  resolution: Resolution | null;   // non-null iff status === 'closed'
  component: string | null;        // null, or a member of config.components
  assignee: string | null;
  created: string;                 // ISO 8601
  creator: string;
  body: string;                    // verbatim markdown
  log: LogEntry[];
  unknown: Record<string, unknown>; // unrecognized frontmatter keys
}
```

Validated invariants:

- `resolution` is non-null exactly when `status === 'closed'`.
- `component` is `null` or a member of the configured component list.
- `id` parses as a UUID and matches the filename stem.

Unrecognized frontmatter keys are captured in `unknown` and written back out, so a file touched by
a newer version survives a round-trip through an older binary without data loss.

## 6. Command surface

Every command accepts `--json`. No command requires a TTY or an interactive prompt, except `edit`,
whose entire purpose is to open one.

| Command | Form |
|---|---|
| `init` | `dz init [--name <name>]` |
| `add` | `dz add "<title>" [--type bug] [--component <c>] [-m <body>]` |
| `list` | `dz list [--status <s>] [--component <c>] [--assignee <a>] [--type <t>] [--all]` |
| `show` | `dz show <id-prefix>` |
| `set` | `dz set <id-prefix> [--status <s>] [--title <t>] [--component <c>] [--assignee <a>] [--type <t>]` |
| `comment` | `dz comment <id-prefix> -m "<text>"` (or `-m -` to read stdin) |
| `close` | `dz close <id-prefix> --as <resolution> [-m "<text>"]` |
| `edit` | `dz edit <id-prefix>` |
| `grep` | `dz grep <regex> [<list filters>]` |

### Semantics

**`<id-prefix>`** is any unambiguous leading substring of the UUID. Ambiguity is an error that
lists the matching candidates with their titles.

**`list`** hides closed issues unless `--all` is given or `--status closed` is explicit. Default
ordering is by `created` ascending, which for UUIDv7 is also filename order.

**`set --status closed` is rejected.** It would leave `resolution` null. The error names
`close --as` as the correct route, keeping the invariant enforced at one point rather than two.
Conversely, `set --status open` on a closed issue clears `resolution` and logs a `status` entry —
that is the reopen path.

**`add`** with no body produces an empty body rather than opening an editor, so it is safe in
scripts and agent loops.

**`-m -` reads from stdin**, uniformly across `add`, `comment`, and `close`. There is no separate
`--body` flag; one convention covers every command that takes free text.

**`edit`** spawns `$EDITOR` on the issue file. On exit the file is re-parsed and validated; if it
is invalid, the error is reported and the file is left exactly as the user saved it, never
reverted. No log entry is appended, because the tool cannot know what changed.

**`grep`** matches a JavaScript regex against title, body, and log text, and accepts the same
filters as `list`.

## 7. Error handling

A single `DzError` carrying a machine-readable `code`:

| Code | Meaning |
|---|---|
| `NO_PROJECT` | No `dz/config.yaml` found walking up from cwd |
| `NOT_FOUND` | No issue matches the given prefix |
| `AMBIGUOUS_PREFIX` | More than one issue matches |
| `INVALID_FIELD` | A field value violates the schema or an invariant |
| `PARSE_ERROR` | An issue file is malformed |
| `CONFLICT_MARKERS` | An issue file contains VCS conflict markers |

Exit codes: `0` success, `1` user error, `2` usage error, `3` internal error.

In `--json` mode, errors are written to **stderr** as `{"error":{"code","message"}}` and stdout is
left empty. Keeping stdout a pure success channel means an agent can parse it unconditionally.

Two behaviors matter more than their size suggests:

**A malformed file never fails the whole command.** `list` and `grep` skip unparseable issues, emit
a warning naming each one, and exit `1` at the end. One bad file cannot hide the other forty.

**Conflict markers get a dedicated error.** A file containing `<<<<<<<` produces `CONFLICT_MARKERS`
naming the file, not a confusing YAML parse error. Since the premise is issues living in a VCS,
this is the failure users will actually hit.

## 8. Testing

Vitest, test-driven, in three tiers.

**Serialization (no filesystem).** Round-trip properties — `parse(render(x))` deep-equals `x` — plus
a fixture corpus covering: empty body; no log section; unicode and emoji in titles; a `---` line
inside the body; unknown frontmatter keys; multi-line comment continuations; CRLF input; a missing
trailing newline; and conflict markers.

**Core (no filesystem).** Prefix resolution against synthetic id sets (unique, ambiguous, no
match, full-length id, empty prefix); status transition validation including the rejected
`set --status closed` and the reopen path; component validation against a config; UUIDv7
monotonicity within a millisecond.

**CLI integration.** The built binary run against a temp directory, asserting on `--json` payloads
and exit codes. Covers each command's happy path, `init` in and out of a git repo, and the
malformed-file partial-failure behavior. Human-readable output gets smoke tests only; asserting on
formatting is brittle and low-value.

## 9. Dependencies

Runtime: `commander` (argv parsing), `yaml` (frontmatter — preserves key order and comments, which
keeps diffs readable), `uuid` (v7; Node's `crypto.randomUUID` is v4-only).

Development: `typescript`, `vitest`, `@types/node`.

Binary name `dz`, package name `ditz2`. Both are trivially renameable and not load-bearing.

## 10. Deferred

### TUI (v2)

Not in v1. A TUI is a fourth consumer sitting where `cli/` sits — on top of `core` and `store`,
parallel to the CLI, not beneath it. Deferring costs nothing because the v1 architecture already
provides what a TUI requires: `core` and `store` perform no I/O and throw typed errors instead of
printing, and `render/` is already separated from command dispatch.

Building it in v1 would cost a render loop, focus and keyboard handling, list virtualization, a
text input widget, and resize behavior — plausibly more code than the rest of v1 combined, tested
far less well than pure functions are, and designed before daily use has revealed which views are
actually wanted.

When built, **Ink** (React for the terminal) is the intended choice. Anticipated first views: a
filterable issue list with a detail pane, and inline status changes.

In the meantime, clean `--json` output makes `dz list --json | fzf | xargs dz show` a usable
interactive browser with no code at all.

### Releases

Named milestones grouping issues, with a release considered done when all its issues close. Adds a
frontmatter field and a small set of commands. Omitted from v1 to keep the concept count at two.

### Event-sourced core

Promote the per-issue log to authoritative and demote the frontmatter to a derived cache, with a
merge driver that unions log lines and a `dz repair` that regenerates stale frontmatter. Worth
doing when concurrent edits to the same issue become common enough to be annoying. The v1 file
format is already compatible.
