# Handoff

Current state and what to pick up next. **This file goes stale** — update it
when you finish a chunk of work, and distrust anything here that the repository
contradicts. Durable knowledge belongs in `CLAUDE.md`, the specs, or the issue
tracker; this file is only the part that changes.

**Last updated:** 2026-08-26, at commit `f3e403e349d1`.

## State

21 draft commits on public base `b5f861f5f772`. Tree clean. **366 tests
passing** across 28 files; typecheck and `the linter` clean.

Re-derive rather than trusting the hashes above:

```bash
git log --oneline -5
```

**Nothing is pushed** without being asked.

## What exists

A complete CLI issue tracker, `dz`, whose issues are Markdown files under
`dz/`. It dogfoods itself: this project's own backlog lives in `dz/issues/`.

It also has a narrow public API at `src/api/`, published as the package's only
importable path through an `exports` map:

```ts
import { openProject } from 'ditz2';
const dz = openProject(process.cwd(), { env: process.env });
```

**The CLI calls that same API.** It is not a parallel implementation and must
never become one — see the rule about checkers holding their own copy of a rule
in `CLAUDE.md`. `init`, `schema` and `help` are the deliberate exceptions;
`init` is the only command that runs without an existing project, so it cannot
be a `Project` method.

## Next

Plan two of `docs/superpowers/specs/2026-08-25-ditz2-tui-design.md`: the
`ditz2-ui` package, an Ink-based terminal UI. Designed and approved, no
implementation plan written yet. Plan one — the API facade — is what shipped;
its plan is at `docs/superpowers/plans/2026-08-25-ditz2-api-facade.md`.

Two of that spec's riskiest assumptions were spiked before it was written and
the results are recorded in it:

- Ink's suspend-to-`$EDITOR` works **without unmounting**. The obvious
  `unmount()` then `rerender()` silently drops state updates and resumes
  showing pre-edit data.
- `ink-testing-library` renders to a plain string and accepts synthetic keys,
  so the UI is testable to the same standard as everything else here.

## Open question

`package.json` declares `engines: ">=20"`, and both READMEs justify it by
`uuid@11` reading a global `crypto` absent below that. **That does not
reproduce everywhere.** System Node is v16.20.2, `globalThis.crypto` is
present, and `dz init`, `dz add` and `dz list` all work under it — so the
`#!/usr/bin/env node` shebang picks up unsupported Node and appears fine.

Either the floor is wrong or it is justified by a case this machine does not
exhibit. It is the one place the repository currently documents something there
is evidence against. Settle it before anyone relies on the explanation.

## Loose ends

Parked by review as non-blocking:

- `shq` and `until` helpers are duplicated between
  `tests/cli/edit-double-race.test.ts` and `tests/cli/edit-scratch-path.test.ts`.
- `parseEdit` hardcodes `'the edited text'` as its parse source label
  (`src/api/write.ts:160`), because the facade must not know about the CLI's
  scratch file.

One issue is open in the tracker and correctly so — run `dz list` to see it. It
is the lazily built sqlite cache for `list` and `grep`: `loadAllIssues` takes
50-125 ms over 200 issues and scales linearly, which is the first ceiling a TUI
refresh will hit.

## Where the rest lives

| | |
| --- | --- |
| Toolchain, and the rules this project's defects earned | `CLAUDE.md` |
| Why it works the way it does | `README.md` |
| Designs and implementation plans | `docs/superpowers/` |
| The backlog | `dz list`, `dz show <prefix>` |
