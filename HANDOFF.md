# Handoff

Current state and what to pick up next. **This file goes stale** — update it
when you finish a chunk of work, and distrust anything here that the repository
contradicts. Durable knowledge belongs in `CLAUDE.md`, the specs, or the issue
tracker; this file is only the part that changes.

**Last updated:** 2026-09-03.

## State

Six commits, none pushed. Re-derive the hashes rather than trusting them:

```bash
git log --oneline
```

| | |
| --- | --- |
| the tracker itself | `ditz2: a serverless CLI issue tracker…` |
| upstream, landed elsewhere | `log: stop writing trailing whitespace…` |
| the facade | `extract a narrow public API and put the CLI on top of it` |
| the UI | `add ditz2-ui, a full-screen terminal UI for browsing the backlog` |
| portability | `make the test suites run on macOS` |
| **plans 2b and 2c** | `ditz2-ui: write from the terminal UI — comment, close, and the field form` |

That last one is a squash. Prose below still talks about plan 2b's six
commits, plan 2c's seven, and the three-commit cleanup between them, because
that is how the work was done and reviewed; here they arrived as one.

**403 tests** in the root package, **334** in `ui/` — `ui/` was 167 before plan
2b and 259 before 2c — both typechecks clean, tree clean. `npm run test:all`
exits 0; read that from `echo $?` and not from the log, for the npm 8 reason
below. The linter is clean and means nothing here; see the open question about
it.

**Nothing is pushed** without being asked.

## What exists

A CLI issue tracker, `dz`, whose issues are Markdown files under `dz/`. It
dogfoods itself: this project's backlog lives in `dz/issues/`.

A narrow public API at `src/api/`, the package's only importable path:

```ts
import { openProject } from 'ditz2';
const dz = openProject(process.cwd(), { env: process.env });
```

**The CLI calls that same API.** Not a parallel implementation, and it must
never become one — see the rule in `CLAUDE.md` about a checker holding its own
copy of the rule it checks. `init`, `schema` and `help` are the deliberate
exceptions.

And `ditz2-ui`, an Ink terminal UI in the `ui/` workspace. Two entry points —
`dz ui` hands over by dynamic import, `dzui` runs standalone. It takes the
alternate screen and gives it back on quit, Ctrl-C, a throw before mount, and
SIGINT/SIGTERM/SIGHUP.

**It writes now.** `c` comments on the selected issue, `x` closes it with a
resolution picker and an optional comment, `tab` edits the selected issue's
five fields through `set` and `n` opens the same form empty to create one
through `add`, and every one of them goes through `runMutation` in
`ui/src/mutate.ts` — the one path every write takes, which is where the two
failures a TUI must survive are turned into state rather than a crash. A
contended lock is a waiting overlay that names the holder, counts the wait from
the *first* refusal across retries, and offers `r`. Everything else the facade
raises is an error overlay on the status line, dismissed with `Esc`, over a list
that stays fully interactive underneath. Anything that is not a `DzError` is a
bug in the UI package and is rethrown rather than dressed up.

## Next

**Plans 2b and 2c are both done**, all six tasks of one and all seven of the
other. `docs/superpowers/plans/2026-08-30-ditz2-ui-write.md` and
`docs/superpowers/plans/2026-09-02-ditz2-ui-form.md` are the plans they
executed; read the rulings below before trusting either text.

The spec's "plan two" splits three ways and **2d is the only part left**:
`$EDITOR` body editing and the conflict overlay. The `Body` row the form draws
today is a line count and nothing more — no key opens it, and neither the
footer nor `?` says one does. `e` is still unbound, deliberately.

**The 2d spike is already done**; see the next section. Its headline is that
plan 2d must forbid `unmount()` + `rerender()` outright rather than describe it
as a worse alternative.

**`Tab` opens the form, not `Enter`, and that shipped.** The spec said `Enter`;
the full-screen reader took it, and also uses it to close. `e` is the spec's
key for editing the body in `$EDITOR`, which is why 2c left it alone. Whatever
2d binds, the footer and the `?` overlay must both name it — there are tests
refusing a footer that advertises a dead key, and refusing a working key the
footer omits. `LIST_KEYS`'s second line was sized with a placeholder for 2d's
key already counted, so there is room.

### The 2d spike is already done

`docs/superpowers/spikes/2026-08-30-ink-editor-suspend.md`, moved there out of
gitignored scratch so it survives. Run in a real pty against Ink 6.8.0, because
the spec measured 7.1.1 which this toolchain cannot install:

- Suspend without unmounting **works**. Post-resume state renders, the keyboard
  is live, and the child gets a real tty.
- The alternate screen makes **no difference**, including the nested case where
  the editor uses it too — so 2d does not need to leave and re-enter it around
  `$EDITOR`, and the spec's sequence stands as written.
- `unmount()` + `rerender()` fails **worse than the spec says**: no frame is
  ever drawn again, `waitUntilExit()` resolves before the edit finishes, and
  the process will not exit on `q`. Plan 2d should forbid that path outright
  rather than describe it as a worse alternative.

## Rulings that override the plan document

Plan 2c inherits this code, so these are the parts of the plan text that are no
longer what the repository does. The human partner decided all three.

**The comment draft is cleared on `Esc` and after a successful write, and on
open only when the overlay *or* the issue it would reopen into is a different
one.** The plan
asked for "clear on open, so a failed write keeps the text", which cannot hold
as written: the overlay a failed write leaves you reopening *is* an open, so
clearing unconditionally there is exactly what throws the text away.

There are three clearing points, and 2c reuses `draft`, so read all three before
assuming any of them:

1. `Esc` on either overlay.
2. Inside the thunk `runMutation` calls, on a successful write — *inside*, not
   after, because `r` on the waiting overlay reruns that same thunk and a retry
   that finally lands has to consume the draft too.
3. `startDraft` (`ui/src/app.tsx`), on open, **when `draftFor` names a different
   issue or a different overlay kind**. This one is load bearing and deliberate:
   the issue half stops text typed about one issue reaching another, since the
   error overlay leaves the list free to move; the kind half stops a refused
   comment's text being carried into the very next `x` `^S`, which is reachable
   with no `Esc` at all and would mean "close as fixed, no comment" silently
   writing that sentence into the log.

Reopening the *same* overlay on the *same* issue is the case that keeps the
text, and it is the case a failed write leaves you in.

**The close overlay's resolution is cleared in that third branch too, and
nowhere else.** It used to be reset unconditionally by the `x` handler while
`startDraft` returned early and kept the text, so a refused `wontfix` reopened
showing the operator's own sentence over a picker silently back on `fixed` —
and the sentence is exactly what makes them believe the form came back, so the
next `^S` wrote a resolution nobody chose. That was parked during the tasks as
a cosmetic inconsistency and it was not one. The two halves are one form now:
they restore together or they clear together, and only `startDraft` decides
which. `focus` is deliberately outside that rule — it is where the cursor was
standing, not something the operator chose, and every open starts on the
picker.

**`Esc` dismisses the error overlay; every other key falls through.** The list
underneath a `{kind: 'error'}` overlay stays exactly as interactive as the plain
list screen — the message is a status line, not a modal. That is why
`ERROR_KEYS` is built by prefixing `LIST_KEYS` rather than hand-copied, and why
the `Esc` branch in `app.tsx` is deliberately partial and gated on
`errorActive` rather than on the bare overlay kind.

**The list footer advertises the keys that write.** Plan 2b flipped a plan-2a
test that forbade them, exactly as that test's own comment predicted, and
shipped the zipped `c/x comment/close` because one footer line had no room for
more. Plan 2c gave the footer a second line and un-zipped it: the second line
now reads `tab edit  n new  c comment  x close`. Do not treat either old
assertion as a regression.

## Defects in the plan document itself

Recorded so 2c does not inherit them. Each is a case of the plan asserting
something about the code that turned out to be false, which `CLAUDE.md` already
warns is the normal case rather than the surprising one.

- **Task 2's breakage 4 names an edit that JS control flow makes inert.** The
  reordering it describes cannot change the outcome, so ticking it off would
  have bought confidence nothing had been earned for.
- **Task 3's "clear on open so a failed write keeps the text" is
  self-contradictory**, as above.
- **Task 5's breakage 3 test types only letters**, and no binding the picker
  could plausibly regress is reachable by a letter — so that check could not
  fail either.
- **Task 6's close test asserted a full uuid against `dz list`'s table**, which
  prints `shortId`. The negative half (`not.toContain(id)`) was therefore true
  of an issue sitting plainly in the list — a check that cannot fail — and the
  positive half against `--all` could not pass even on a correct close. The
  committed test uses `dz list --json`, which carries whole ids, so both halves
  mean what they say.
- **Task 6's "no author configured" test unset `DZ_AUTHOR` and nothing else.**
  `dz init` probes `git config user.name` and `sl config ui.username`, both of
  which read the user's *global* configuration and answer in a bare temp
  directory outside any repository, and stores the result in
  `dz/config.local.yaml`. Every fixture project therefore has an identity, the
  write would have succeeded, and the test would have failed here while passing
  on a machine with no VCS identity at all. `forgetIdentity()` removes the file;
  it uses `force` so it is also correct on the machine that never wrote one.

## Open questions

**`settle()` is a race against machine load, and it gets worse with every test
file added.** `ui/tests/helpers.tsx`'s `settle()` is
`new Promise((r) => setTimeout(r, 25))` — a fixed 25 ms of *real* time — and
`press()` awaits one after every single key it writes. So it does not wait for
a repaint; it waits for a duration and hopes. The more test files run alongside
it, the likelier a repaint misses that window and a key is measured against the
previous frame. Task 5 saw exactly that once, in `narrows the list as it is
typed`, on a suite that had just grown by a file. **Every key-driven test in
`ui/` goes through `press`**, so this is not local to one file.

This is **distinct from the pty flake** in `e2e.test.ts` recorded below —
different harness, and no `script`, no canonical mode and no raw-mode gap
involved — but it has the same root cause: waiting for a duration rather than
for evidence. **The fix is to wait on a condition** — write the key, then poll
until the frame changes or a named marker appears, with the timeout only as a
backstop. That is a change to `press` and therefore to every test in the
workspace, which is why it was recorded rather than done. Nobody has measured
how often it fires; the one observation is Task 5's.

**Ruling 2's message reads oddly and is accepted-for-now rather than settled.**
`n` under an active filter creates the issue, dispatches `select` with the new
id, and `mutationSucceeded`'s `reselect` either lands the cursor on it or says
`<shortId> is no longer in the list` (`ui/src/state.ts:131`). For an issue that
was never in the list, "no longer" is wrong. The human partner accepted it as
revisitable because the alternative is a notice `mutationSucceeded` would have
to stop clearing. **It is here so that it is not rediscovered as a bug.**

**`engines: ">=20"`**, justified in both READMEs by `uuid@11` reading a global
`crypto`. That does not reproduce everywhere: system Node is v16.20.2,
`globalThis.crypto` is present, and `dz init`/`add`/`list` all work under it.
Either the floor is wrong or it is justified by a case this machine does not
exhibit. It is the one place the repository documents something there is
evidence against.

**A `package-lock.json` regenerated against a private registry mirror will not
install anywhere else.** 129 of its `resolved` URLs once pointed at one, and
`--registry` does not override a `resolved` URL, so `npm ci` needed credentials
for a host most people cannot reach. They are all on `registry.npmjs.org` now.
Check before committing a regenerated lockfile — the only two `resolved`
values that may not be `registry.npmjs.org` are the two workspace links:

```bash
grep '"resolved":' package-lock.json | grep -v registry.npmjs.org
#       "resolved": "",
#       "resolved": "ui",
```

**npm 8.19.4 discards the exit status of workspace-member scripts.** Confirmed
in a minimal reproduction outside this repo, three ways: `--workspace`, a root
script delegating, and running from inside the member directory. Root scripts
and direct tool invocations propagate correctly, and npm 11 propagates
correctly — 8.19.4 is what this machine's `npm` on `PATH` resolves to, because
a shim puts a vendored Node ahead of the newer npm bundled beside it.

`test:ui` therefore invokes `tsc` and `vitest` directly. **Do not "simplify" it
back to `npm run test --workspace ditz2-ui`** — that turns the gate into one
that reports success for every possible state of the code. Verified: a
deliberate type error in a `ui/tests/*.ts` file makes the direct form exit 2
and the delegating form exit 0.

**The lint gate `CLAUDE.md` names checks nothing here, and the source implies
otherwise.** For the human partner rather than for a plan. Verified on
2026-09-02, in this directory and with a modified `.md` and a modified `.tsx`
in the working copy so that there was something to lint: the formatter prints
*No linters to run.* and the linter prints *No lint issues.* There is no eslint
configuration anywhere in either workspace — no `.eslintrc*`, no
`eslint.config.*`, no `eslint` in either `package.json` and none installed
under `node_modules/` — and no linter configuration either. The source nevertheless
carries three `eslint-disable-next-line react/no-array-index-key` comments, at
`ui/src/components/TextEntry.tsx:71` and `ui/src/components/HelpOverlay.tsx:63`
and `:80`, which read as though something were enforcing that rule. Nothing is.
So `npm run typecheck` is the only static check the project actually has and
the lint step is one that cannot fail — which is the shape `CLAUDE.md`
warns about, in the gate rather than in a test. Worth settling one way or the
other, since either answer changes what "lint is clean" is worth: configure
eslint so the disables mean what they say, or delete them.

## What plan 2b closed

**`lockTimeoutMs: 0` is covered.** It was the loose end this file used to carry
saying it was not, and plan 2a could not close it because nothing wrote.
`ui/tests/e2e.test.ts`'s *refuses a contended write immediately instead of
freezing* holds the lock from outside the UI, types `c x ^S`, and bounds the
time from **Ctrl-S reaching the pty to the first byte of the waiting overlay
coming back out of it** under the two seconds the refusal alone costs with the
default timeout.

**It bounded the whole run until 2026-09-02 and no longer does.** That version
went intermittent exactly as its own review predicted, and the prescribed fix —
scope the measurement, never raise the bound — is what was applied. `pty()`
takes an optional `Probe` naming the keystroke that starts the clock and the
text that stops it, and reports `probeMs`; it adds no waiting, since the reader
still resolves on the child's exit under the same 20-second kill and the probe
only timestamps two events it sees going past. An answer that never comes
leaves `probeMs` null for the caller to assert on.

Both measurements, since the acceptance asked for them. **The bound the test
asserts is `SECONDS_2 = 2000` ms**, fixed in `ui/tests/e2e.test.ts`; everything
in the table is measured elapsed time, not a threshold:

| measured | at `lockTimeoutMs: 0` | at `2000` |
| --- | --- | --- |
| **Ctrl-S to the waiting overlay — what the test now asserts** | **11–15 ms** (five runs) | **2133 ms** |
| the old whole-run bound, kept here for the contrast | 1130 ms (band 1044–1420) | 22010 ms |

**The discrimination is structural rather than a margin, which is the point of
the change.** `acquireLock` sets `deadline = Date.now() + timeoutMs` and throws
only once `Date.now() >= deadline`, so with the default 2000 in force this
measurement cannot come in under 2000 however fast the machine is. Raising the
bound past 2000 destroys that and the test would pass with the freeze it exists
to catch. The passing side now has about 1985 ms of margin and is dominated by
the thing being measured — the refusal and one repaint — rather than by process
startup, which was 99% of the old number.

The 22-second figure is the pty harness's own 20-second kill: with a synchronous
two-second sleep inside `acquireLock`, Ink cannot repaint, cannot read the key
that would dismiss the wait, and cannot service Ctrl-C, so the run does not end
on its own. That is the symptom the `0` exists to prevent, and it is why the
test measures elapsed time rather than asserting the option's value. Note that
the broken state still takes the full 20 seconds to fail — the scoping changes
which assertion fails and why, not how long a frozen UI sits there.

**`whoami()` returning `null` for two different problems is resolved**, in the
way the ruling required rather than by teaching the UI to tell them apart. The
UI does not try. `resolveAuthor` raises the real message at the moment of the
write, inside the facade, which is the one place that knows whether the identity
is missing or malformed, and `runMutation` relays it to the error overlay. Two
end-to-end tests pin it: `DZ_AUTHOR` unset must put `DZ_AUTHOR` on the operator's
screen, a `DZ_AUTHOR` with a double space must say `double space`, and in both
cases `dz show` must find nothing written.

**`mutationLocked` now decides for itself whose wait it is inheriting.** It
used to read `since` and `attempts` off whatever `waitingFor` it found, and was
safe only because `mutationStarted`, one case earlier, nulls `waitingFor` for a
different op. So the reducer case that already refuses to trust the keyboard
handler was trusting the case beside it instead. One line —
`const carry = state.waitingFor?.op === action.op ? state.waitingFor : null` —
moves the guarantee inside the case that states it. The existing tests all pass
either way, which is the finding: the new one in `state.test.ts` dispatches two
`mutationLocked`s with no `mutationStarted` between them, a sequence the UI
cannot produce today and the only one that fails without the guard. Plan 2c
leans on this property hardest.

## What plan 2c changed

**The footer is two lines.** `LIST_KEYS` is an array of two strings, `<Footer>`
pads a short one to `FOOTER_ROWS` and does *not* truncate a long one, and
`app.tsx`'s `CHROME_ROWS` is `2 + FOOTER_ROWS` rather than a literal. **Every
screen's row budget is therefore one row smaller than it was**, which is where
the row went; the close overlay's boundaries moved with it, and the arithmetic
is in the `CloseOverlay` item above.

**The absolute frame-height floor moved with it too**, and the sweep in
`app-keys.test.tsx` starts at `rows = 8` so nothing tests this. Measured on
2026-09-02 on the plain list screen, and again with `FOOTER_ROWS` and
`LIST_KEYS` cut back to one line to reproduce the pre-2c state:

| | frame is | overflows at | fits from |
| --- | --- | --- | --- |
| before 2c, no notice | 5 lines | `rows ≤ 4` | `rows = 5` |
| before 2c, with a notice | 6 lines | `rows ≤ 5` | `rows = 6` |
| now, no notice | 6 lines | `rows ≤ 5` | `rows = 6` |
| now, with a notice | 7 lines | **`rows ≤ 6`** | `rows = 7` |

`listRows` and `detailRows` are both `Math.max(…, 1)`, so below the floor the
body stops shrinking and the frame simply overflows. No terminal that small is
plausible; it is recorded because it is one row worse than it was and nothing
would say so.

**The refused-`add` draft is keyed by mode alone, and this is known behaviour
rather than a bug.** `startForm`'s `kept` matches a held form on its mode and
its issue, and for `add` the issue is null on both sides, so mode is the whole
of the key. Observed on 2026-09-02 against a stub whose `add` refuses: `n`,
type `shiny`, `^S` → refused; `n` again brings the form back holding `shiny`;
`esc` then `n` correctly starts blank; but **`tab` instead of `n` opens a fresh
edit form and `shiny` is gone for good** — there is no key that brings it back.
Ruled acceptable and consistent: plan 2b's `{id, kind}` draft key deliberately
clears a comment when the overlay kind changes, for the stronger reason that a
sentence meant as a comment must not be written as a close reason. The edge is
sharper here only because a form holds five fields rather than one sentence.
`ui/README.md` says so in the operator's words.

**`form.mode === mode` in that same `kept` computation is redundant**, and a
comment in `app.tsx` now says so. Both `FormState` and `FormSubject` are the
same discriminated union, so whenever the id comparison holds either both sides
are null — two `add`s — or both are ids, which only two `set`s can be. It is
kept because it states the rule the id comparison merely implies, and a task
brief has already mistaken it for load bearing once. **Do not delete it, and do
not describe it as load bearing.**

**Two findings are now closed, and they come from two different lists.** Both
are struck through where they were recorded, with what closed them:

- *CLOSE_TOO_SHORT is never cleared*, from **Parked with rulings by the final
  re-review** — the section that opens "The last review of plan 2b raised four
  Minors". It is **one of that four, not two**: the other three stay open,
  namely the short-terminal guard refusing a row too early, the frame sweep
  recording that over-refusal as expected behaviour, and a stale resolution
  outliving a *successful* close. Each is still labelled *(checked, still
  open.)* there.
- *`ui/` has no analogue to `tests/cli/repo-filesystem.test.ts`*, from
  **Deferred by the review of Task 6**, a different list entirely.

Plan 2c's Step 4 says "the other two are untouched", counting across the two
lists as though they were one. **Three stay parked, not two**, and one of the
three — the over-conservative short-terminal boundary — 2c made a row worse
rather than better.

## Loose ends

Parked by review as non-blocking. Statuses here were re-checked on 2026-09-02
except where marked.

- `until` is still duplicated between `tests/cli/edit-double-race.test.ts` and
  `tests/cli/edit-scratch-path.test.ts`. `shq` no longer is — the portability
  work moved it into `tests/pty.ts` and all four callers import it.
- `parseEdit` hardcodes `'the edited text'` as its parse source label, because
  the facade must not know about the CLI's scratch file.
- The `assignee:me` email-part rule in `ui/src/query.ts` is a guess about how
  people write assignees. Still a guess; the UI has now been driven by hand but
  not lived with.
- Help paging on the issue screen uses the list's page delta, so `PgDn` scrolls
  fewer lines than that screen could show. Inefficiency, not a defect.
  **Unverified this session.**
- **(checked by reading `app.tsx` on 2026-09-03, not exercised.) A retained
  form is never invalidated by another successful write.** `setForm(null)` runs
  on `Esc`, on the `no changes` path, and inside the form's own write thunk —
  nowhere else — so a write by `c` or `x` leaves a held form untouched. Under
  `all:true`: `tab` on A, refused, `esc`, `x` closes A, `tab` on A again, and
  `startForm`'s `kept` branch brings back the form still reading
  `Status: open`. **The write is safe**, so this is stale display and nothing
  more: `changedFields` diffs against `open.issue`, the same read the values
  were typed over, and `^S` still sends only the fields the operator changed.
  **Decide it in 2d rather than after it**, because `$EDITOR` body state has
  exactly the same lifetime question and two answers to it would be two rules.
- **(checked by reading on 2026-09-03.) `FilterField` still loses its cursor,
  and it is a second copy of the rule `TextEntry` now owns.**
  `FilterField.tsx:15` truncates a slash, the query and a block cursor to the
  width — it draws that cursor itself and calls `truncate` directly, so it never
  inherited the horizontal scrolling that fixed the same defect in the form and
  the comment entry. Slash plus query plus cursor is `query.length + 2`, so at
  width
  80 a query of **79 characters or more** renders as head-plus-ellipsis with no
  cursor and every further keystroke invisible. Reachable, if not often: the
  filter takes bare regexes. **The fix is not another slice** — it is
  `FilterField` drawing through `TextEntry` so that one file owns where the
  cursor goes, which is the `dz doctor`/`IGNORE_LINE` rule applied to a
  component instead of a constant.
- **(checked by reading on 2026-09-03.) `tailOf` counts UTF-16 code units, not
  display columns.** `TextEntry`'s horizontal invariant therefore holds for
  ASCII and breaks for wide CJK and emoji, which occupy two columns each and
  can also be surrogate pairs — the kept tail can overrun the budget, and the
  comment above it states the rule without that qualification. Consistent with
  `truncate`, `pad` and `rowFor`, which measure the same way, so this is one
  project-wide decision rather than a local slip: either the UI adopts a
  width-aware measure everywhere or the invariant is documented as
  ASCII-column. Do not fix it in one place.

### Deferred by plan 2b's reviews

Each was raised, judged not worth blocking on, and left. None is fixed.

**Read the markers.** These were transcribed out of review notes at the end of
the plan. Transcribing a finding is not verifying it, so each says which it is:
**(checked)** means I read the code this session and it holds as stated;
**(transcribed)** means it is the reviewer's claim, untested by me, and should
be confirmed before anyone acts on it.

- **(checked) `retryTick`'s `at` payload is dead.** The reducer's case is
  `state.waitingFor === null ? state : { ...state }` and never touches `at`; the
  elapsed line is computed from `Date.now()` at render time on purpose, so the
  action exists only to force that re-read.
- **(checked) `write()` in `ui/src/app.tsx` spells the `runMutation` argument
  list twice**, once stored as the retry thunk and once run immediately, on
  consecutive lines. If the two drift, `r` stops being the same call it repeats.
- **(checked, and fixed — the diagnosis it was recorded with was wrong.)** The
  close overlay overflowed the frame on a short terminal. **The magic `5` was
  not the bug**: the chrome really is `RESOLUTIONS.length + 4` (title, spacer,
  picker, spacer, label), so subtracting `+ 5` left the overlay one row *under*
  budget, and changing the 5 to a 4 would have made the overflow worse rather
  than fixing it. The cause was those seven chrome rows being unconditional
  while `<TextEntry>` always draws at least the one line the draft holds: the
  overlay cannot render in fewer than **eight** rows however small the budget
  gets. Measured frame heights, which matched the review's table exactly:
  `rows=8` drew 10 lines (11 with a notice), `9` drew 10 (11), `10` drew 10
  (11), `11` and up fitted. `index.tsx` passes terminal rows minus one, so an
  eleven-row terminal was the boundary.

  **Fixed by refusing rather than folding.** `CLOSE_OVERLAY_ROWS` is exported
  from `CloseOverlay.tsx` — the file that owns the layout — and `app.tsx`'s `x`
  handler declines to open the overlay below it, saying `CLOSE_TOO_SHORT` on
  the status line instead. Dropping the two spacer rows was the other candidate
  and it cannot be made to hold: the compact form still needs six rows, so a
  nine-row terminal would overflow again, and there is no bottom to that
  regress short of hiding resolutions the arrows can still select. The `5` is
  now spelled `rows - CLOSE_OVERLAY_ROWS`, the same arithmetic named.

  **The refusal is deliberately more conservative than the overflow, and the
  two boundaries are not the same number.** What `x` compares against
  `CLOSE_OVERLAY_ROWS` is `listRows + detailRows`, the *list* screen's budget,
  which holds `DETAIL_BORDER_ROWS` back for a rule the overlay screen never
  draws. Left that way on purpose — the invariant is *an overlay draws inside
  the budget App gave it*, App gives every overlay the same budget, and
  teaching `x` alone to compute a second looser one would be a second rule to
  keep true for the sake of a row. Write neither boundary as though it were the
  other.

  **Both boundaries moved a row when plan 2c gave the footer its second line**,
  because `CHROME_ROWS` is `2 + FOOTER_ROWS` and every screen's budget shrank
  by one. Re-measured on 2026-09-02 against the current sources, by dispatching
  `openClose` into the initial state so that `x`'s guard is bypassed:

  | | fits from | `x` opens from |
  | --- | --- | --- |
  | before 2c, one-line footer | `rows = 11` | `rows = 12` |
  | now, two-line footer | `rows = 11` with no notice, `12` with one | `rows = 13` |

  The overlay itself draws 11 lines, 12 with a notice. So the gap is one row
  with a notice showing and **two** without, where it used to be one either
  way — the over-refusal got slightly worse, and the frame sweep in
  `app-keys.test.tsx` tracks it at `minRows: 13`. Through `index.tsx`'s
  `rows = terminal − 1`, `x` now needs a fourteen-row terminal.

  The frame-height sweep in `app-keys.test.tsx` now opens each screen at
  `[8, 9, 10, 11, 12, 20, 23]` and carries a per-screen marker, because it
  pressed no keys at all before and measured the list three times over. Both
  halves of the miss are closed: the local `mount` in that file also moved from
  ten rows to fourteen, since at ten the footer sweep was measuring the list
  footer under a close overlay that had not opened.
- **(checked, count differs — and since fixed.)** The overlay render in
  `app.tsx` was a deep nested ternary. The review called it six levels; what I
  counted is a five-deep chain in the body (help → comment → close → waiting →
  issue → list) and a second five-deep chain in the footer, which between them
  may be what was meant. Either way 2c's form would have added a level to both,
  and re-indenting had already hidden the real change in whitespace twice.

  **Both chains are now one table**, `overlays` in `app.tsx`: a
  `Record<OverlayKind, OverlaySlots>` where each row says what its overlay
  draws in the body and in the footer, and a null slot means it leaves that
  half to the screen underneath. Overlay kinds are mutually exclusive, so no
  ordering between overlays survives the change; the precedence that used to be
  spelled twice — whether an overlay outranks the screen it covers — is now
  answered once per row for both slots at the same time. `errorActive` is kept
  and is what makes the error row's footer slot empty on the issue screen.
  Verified two ways rather than asserted: making that footer unconditional
  fails `comment.test.tsx`'s *does not carry the error footer onto the issue
  screen*, and adding a seventh kind to `UiState.overlay` fails to compile in
  `app.tsx` until the new row is written. The second is new — the old chains
  would have let an unhandled kind fall through both, silently. **2c adds its
  form as a row here**, not as another nesting level.
- **(checked, and narrowed by plan 2c.)** `HELP` used to document `c` and `x`
  on the list screen but none of the overlays' own `^S` / `esc` / `tab` / arrow
  bindings. It now carries `tab`, `n`, and an `in the form` block spelling out
  tab/shift-tab, up/down, `^S` and `esc`, plus `while a write waits`. **The
  comment and close overlays are still undocumented there** — their `^S`, `esc`
  and resolution arrows appear only in their footers. The comment, close, form,
  waiting and filter branches in `useInput` all return before the `?` handler,
  so `?` cannot open from inside those — **but the error overlay is not one of
  them**, and an earlier version of this line said it was. Its branch
  (`app.tsx`, gated on `errorActive`) intercepts `Esc` alone and lets every
  other key fall through on purpose, so `?` reaches `toggleHelp` and replaces
  the message with the help screen. **Observed on 2026-09-03**, by a throwaway
  probe that failed a comment, pressed `?`, and read the bindings back where
  the error had been; then deleted. That is consistent with the list under an
  error staying fully interactive; it is only the blanket wording that was
  wrong. `ui/README.md`'s Keys table now says the same thing.
- **(transcribed) `up/down move` is the one `LIST_KEYS` entry with neither a
  positive nor a negative assertion anywhere.** I did not audit the suite for
  this.
- **(transcribed) The `dim` focus cue has no coverage.** The prop is real —
  `CloseOverlay.tsx:58` has `dimColor={focus !== 'comment'}` — and ANSI is
  stripped under vitest, but I did not check whether some other test reaches it.
- **~~(checked) `ERROR_KEYS` is exactly 80 characters against an 80-column
  fixture~~ — fixed by plan 2c's second footer line.** It had no slack at all:
  `LIST_KEYS` measured 67 and the `esc dismiss ` prefix brought it to 80
  exactly, so adding a word would have truncated it silently. Re-measured on
  2026-09-02, every footer constant against the 80-column fixture:

  | | length |
  | --- | --- |
  | `LIST_KEYS[0]` | 48 |
  | `LIST_KEYS[1]` | 35 |
  | `ISSUE_KEYS[0]` | **62 — the widest** |
  | `COMMENT_KEYS[0]` | 53 |
  | `CLOSE_KEYS[0]` | 51 |
  | `FORM_KEYS[0]` | 54 |
  | `WAITING_KEYS[0]` | 22 |
  | `ERROR_KEYS[0]` | 61 |
  | `ERROR_KEYS[1]` | 35 |

  The **widest footer line in the project is `ISSUE_KEYS[0]` at 62**, not the
  composed `ERROR_KEYS[0]` at 61 — a distinction plan 2c's acceptance already
  makes and which any later brief quoting "the widest, at 61" has got wrong.
  **Plan 2c shipped that error into two places in the repository and both are
  now corrected**: `ERROR_KEYS`'s own comment in `ui/src/app.tsx`, which called
  it the widest footer in the project, and the margin test's name in
  `app-keys.test.tsx`, which was *leaves room on the widest line*. Both now say
  **composed** and both explain why the composed line is still the right
  subject for a margin: `ISSUE_KEYS` is a literal that changes only when
  somebody edits it, while `ERROR_KEYS[0]` is `LIST_KEYS[0]` plus a fixed
  prefix and grows on its own every time the list gains a binding, which is how
  the ceiling was reached both times. The width sweep covers all seven footers,
  `ISSUE_KEYS` included, against being clipped. The sweep's own doc comment
  also said the write-failure footer sits "at exactly 80 of 80 columns", which
  was true before the second footer line and is not now; corrected too.

  Everything is inside 80 either way, and `app-keys.test.tsx` pins the
  projected post-2d second line
  (`LIST_KEYS[1]` + `  e body`, derived rather than copied) so that plan 2d
  meets the ceiling here rather than in a truncated footer.
- **`pending` (`ui/src/state.ts:38`) is written and never read.** **(checked)**
  by grep: `pending` appears in `state.ts` and in `state.test.ts` and nowhere
  else in `ui/`, so no component can render anything from it. **(transcribed,
  and it follows from `mutate.ts` being straight-line synchronous)**: the
  reviewer's point is that `runMutation` sets `pending: {op}` and clears it in
  the same synchronous handler, which Ink runs inside React's batching, so no
  render could observe it non-null even if something did read it. Its doc
  comment — *A write is in flight. Set between the call and its outcome* — is
  true and unfalsifiable, which is the shape `CLAUDE.md` warns about. **It
  looks like the hook for a spinner and it is not one**: a spinner needs a
  render between the two dispatches and there is none. Left in place this
  wave, recorded rather than removed, because 2c may want an asynchronous
  write and this is where that state would go — but if 2c does not take it,
  it should go.

  **2c did not take it.** Re-checked on 2026-09-02: `pending` appears only in
  `ui/src/state.ts` and in `ui/tests/state.test.ts`, and the form's write goes
  through the same synchronous `runMutation` every other write does. **So it
  should go**, unless plan 2d makes a write asynchronous — suspending Ink
  around `$EDITOR` is the first thing in this UI that a render could plausibly
  observe mid-flight. Decide it in 2d rather than carrying it a third wave.
- **(checked) `WaitingOverlay` has the same unconditional floor `CloseOverlay`
  just had, three rows and no guard**, and unlike the close form it cannot be
  refused: it is what a `LOCKED` write turns into, and the write has already
  happened by then. It overflows only below a six-row frame budget, which the
  new sweep does not reach and no plausible terminal produces. Noted because it
  is the sibling branch of the one that was fixed, not because it is reachable.

### Deferred by the review of Task 6

- **~~`ui/` has no analogue to `tests/cli/repo-filesystem.test.ts`.~~ CLOSED by
  plan 2c.** `ui/tests/e2e.test.ts`'s *saves the form on the filesystem the
  repository itself lives on* builds its project under
  `.dz-fstest/ui-form/run-*` inside the checkout — `stat -f` reports `fuseblk`
  there against `btrfs` for `/tmp`, so on this machine the two really are
  different filesystems — drives `tab`, an edit and `^S` through the built
  `dzui` in a pty, and reads the new title back with `dz show --json`. It
  deletes only its own subdirectory: `tests/cli/repo-filesystem.test.ts` owns
  `.dz-fstest` itself and clears it wholesale, and two files racing to delete
  each other's tree is a flake waiting for whoever runs the suites in parallel.

  **It is a check that cannot fail on this machine**, and that is its standing
  rather than a defect — the same standing `tests/cli/repo-filesystem.test.ts`
  has on an ordinary clone. Retargeting `CHECKOUT_SCRATCH` at `os.tmpdir()`
  changes nothing, confirmed. To watch it fail on purpose, make `openProject`
  throw for paths under the scratch root: the built `dzui` then dies with exit
  code 3 and this is the only `ui/` test that reports it. Confirmed on
  2026-09-02.
- **`e2e.test.ts` duplicates a spawn-and-throw wrapper.** `project()`'s local
  `run` and the module-level `dz()` are the same eight lines; `run` could be
  `(args) => dz(dir, args)`. Still true. The checkout-filesystem fixture plan
  2c added, `inCheckout()`, calls `dz()` directly and does not add a third
  copy.
- **The close test's `toContain('closed')` and `toContain('fixed')` have never
  been observed failing.** The breakage that stubs out `project.close` trips the
  `dzList` assertion several lines earlier, so those two are carried by the
  assertions above them rather than proven on their own.
- **The pty helper's timing assumptions are load-sensitive, and this is now
  measured rather than hoped.** `pty()` waits 150 ms after Ink's first frame
  before typing — the gap in which raw mode is turned on — and 40 ms between
  keystrokes. The old claim here was that both had been enough "in every run so
  far"; that is no longer true. On 2026-09-02, with 32 busy loops on this
  32-core Linux host, **7 of the 15 pty tests failed**, and the two signatures
  say plainly what breaks: *draws the backlog and quits on q* types one key and
  timed out, and *loads closed issues* rendered `filter: ll:true` — the leading
  `a` was simply lost. Keys delivered before raw mode is on are swallowed by
  canonical mode, which is the hazard `pty()`'s own doc comment already
  describes. It still fails in the safe direction: a lost key fails the test,
  it does not pass one wrongly.

  Unloaded the file passes; at moderate load it flakes at roughly one run in
  four, always as a 20-second timeout or a dropped character, and always in
  runs whose own duration has roughly doubled. **If this becomes a nuisance the
  fix is to wait for evidence rather than for a duration** — key, then look for
  the frame it should have produced, the way the lock probe now does — not to
  lengthen the two constants, which only moves the load at which it breaks.
  Left alone here because it is a harness change touching all fifteen tests and
  it deserves its own decision.

### Deferred by the whole-branch review

Raised against the branch as a whole, ruled out of scope for the fix wave, and
left. Each was **(checked)** against the file named this session — read, not
exercised, except where a bullet says otherwise.

- **Dismissing an error resurrects an older notice.** The `<Notice>` call in
  `app.tsx` picks `state.overlay.message` when the overlay is an error and
  `state.notice` otherwise, and `closeOverlay` does not touch `notice`. So
  `Esc` can uncover a message that described something two events ago.
- **An error message on the issue screen has no dismissal and no advertised
  key.** `errorActive` is false on the issue screen, so `Esc` goes to
  `closeIssue` and the message stays on the status line until something else
  replaces it. `ISSUE_KEYS` names no way to clear it, correctly — there is
  none.
- **`HELP` documents `c` and `x` unqualified**, though both are list-screen
  keys: neither does anything from the issue view. The `?` overlay reads as
  though they work everywhere.
- **The `SECONDS_2 = 2000` bound in `e2e.test.ts` had roughly 870 ms of
  margin**, most of the run being process startup rather than the refusal, and
  this bullet's own prescription was *if it ever goes intermittent, measure
  Ctrl-S to the first "waiting for the lock" byte*. **It went intermittent on
  2026-09-02 and that is what was done** — see *What plan 2b closed* above for
  the mechanism and both measurements. **The instruction that did not change:
  never raise the bound past 2000.** 2000 is the default `lockTimeoutMs` the
  test exists to prove is not in effect, and a larger bound passes with the
  freeze it is there to catch.
- **Three near-misses in the suite, all deliberate, all worth knowing about.**
  `not.toContain('enter edit')` in `app-keys.test.tsx` was a forward guard for
  2c and asserted about a key that did not exist yet, so it passed for the
  wrong reason. **2c bound `tab` and it now discriminates**: the footer says
  `tab edit`, and a footer that named `enter` instead would fail it. `Enter`
  itself still does nothing in the form — the spec's `enter pick/edit` assumed
  a picker opening as its own overlay, and `Picker` is inline — so the
  assertion is also still true of the code. `comment.test.tsx`'s *does not carry the
  error footer onto the issue screen* adds `not.toContain('/ filter')` and
  `not.toContain('r reload')`, both already implied by the `q back` above them
  being the issue footer. And `waiting.test.tsx`'s *says so on screen when the
  holder cannot be read* asserts `not.toContain('undefined')`, but the
  breakage it names — interpolating the holder's fields — would throw on a
  null holder rather than render the word, so the assertion is not the thing
  catching it. **The last two are read, not run**: I did not construct either
  breakage this session.

One issue is open in the tracker and correctly so — `dz list`. It is the lazily
built sqlite cache: `loadAllIssues` takes 50–125 ms over 200 issues and scales
linearly. **Plan 2b made this matter more**, because every successful write
reloads the snapshot, putting that cost on the critical path of each mutation.

### Parked with rulings by the final re-review

The last review of plan 2b raised four Minors after the fix wave and ruled on
each rather than fixing it. They lived only in the plan's gitignored scratch
directory, which one `git clean -xd` would have taken with it, so they are
here now. All four were **re-observed on 2026-09-02** by a throwaway probe
rendered against the current sources and then deleted; none is transcribed.

- **(checked, still open, and a row worse after 2c.) The short-terminal guard
  refuses a row too early.** Written up in full in the `CloseOverlay` item
  above, where the boundary arithmetic and the re-measured table belong. The
  second half of that finding was the documentation, and it has been corrected
  in all three places it was wrong: that item; the `minRows` and `HEIGHTS`
  comments in `ui/tests/app-keys.test.tsx`, which say which unit each number is
  counted in, carry `13` rather than `12`, and now give the post-2c fit
  boundary (overflow from `rows = 10` down in both cases, fit from `11` only
  with no notice); and `startForm`'s comment in `ui/src/app.tsx`, which said
  the budget was "one row conservative" and now says two rows with no notice
  and one with.

- **(checked, still open.) The frame sweep records the over-refusal as the
  expected behaviour.** At `rows = 12` the sweep asks for `CLOSE_TOO_SHORT`,
  and its height assertion cannot tell the two behaviours apart — with the
  overlay forced open at that height the frame is 11 lines, 12 with a notice,
  and both are inside the 12 the assertion allows. The refusal marker is the
  whole of
  what holds that case. So whoever later corrects the guard to the overlay's
  own budget will meet a failing test rather than a passing one, which is the
  right way round for a guard nobody meant to loosen and the wrong way round
  for a deliberate fix. The sweep is unchanged: it follows the guard, and the
  two move together or not at all.

- **~~(checked) `CLOSE_TOO_SHORT` is never cleared.~~ CLOSED by plan 2c.**
  `openComment`, `openClose` and `openForm` are now one reducer case and it
  returns `notice: null` (`ui/src/state.ts`), with a comment saying the status
  line is cleared on *open* rather than on close precisely so that a message
  about something earlier cannot sit underneath a form. Re-read on 2026-09-02.
  The original finding: press `x` in a terminal too short for the form, make
  the terminal taller — `index.tsx` re-renders on `resize`, so that is an
  ordinary thing to do — and press `x` again, and the close form came up with
  *the close form needs a taller terminal* sitting underneath it. `Esc` then
  `c` carried the same sentence under the comment overlay.

  **Its sibling is not closed.** *Dismissing an error resurrects an older
  notice* above is a different path — `closeOverlay` still does not touch
  `state.notice` — and reaching it needs an error rather than a refusal.

- **(checked) A stale resolution can outlive a *successful* close.**
  `setDraft([''])` runs inside the thunk `runMutation` calls, on success;
  `setResolution(0)` does not, and nothing clears `draftFor` there either.
  Under `all:true` the issue stays in the list once it closes and stays
  selected, so the next `x` on it early-returns from `startDraft` and the
  picker is still showing the resolution the last close used. Observed: close
  `alpha` as `wontfix` under `all:true`, press `x` again, and the form reads
  `(*) wontfix`. This is the mirror of the asymmetry plan 2b fixed, and it is
  equally untested — but it differs in the two ways that made the other one
  blocking: the wrong resolution is on the screen rather than hidden behind
  restored prose, and the default filter hides closed issues, so nobody reaches
  it without asking for them.

## The acceptance criterion still owed

Plans 2b **and 2c** both require that the UI be **run by hand against this
repository's own backlog**, on the grounds that every requirement gap
in plan 2a was found by a person looking at a screen and none by review. 2c
adds that a form is where that is most true: field order, what the cursor looks
like, and whether Tab goes where the hand expects are not things a test has an
opinion about. **It is still not satisfied and cannot be by an agent.** What
was done instead, and what it does and does not establish:

- The built `dzui` was driven in a real pty against this checkout's own `dz/`,
  26 issues, 1 open. It draws, moves, opens the comment and close overlays with
  the right footers, abandons both on `Esc`, and leaves `git status dz/` empty.
- A comment and a close were written by the built `dzui`, through a pty, to a
  scratch project **on a virtual filesystem** (`stat -f` reports `fuseblk`) rather than under
  `os.tmpdir()` where the whole e2e suite runs, and `dz show` found both. So the
  `link(2)`/`EPERM` class of failure `CLAUDE.md` records is not lurking in the
  UI's write path.
- **Plan 2c repeated that for the form**, on 2026-09-02. `tab` on the real
  backlog drew `edit 01a031ea-9853  Consider a lazily built sqlite cache…` with
  Title focused and the block cursor at the end of the existing title;
  successive Tabs expanded Type, then Status, then Component — one picker at a
  time, the rest showing their value on one line — and Component listed all six
  configured components plus `(none)` with `(*) store` marked. Down moved the
  Type selection. `Body  10 lines` sat at the bottom with no key offered. `Esc`
  came back to the list. `n` drew `new issue` with exactly Title, Type
  (defaulting to `task`) and Component (`(none)`); typing appended; Tab reached
  its Type picker. `Esc` again, `?` twice, `q`. **Nothing was saved, and
  `git status dz/` is empty.** The checkout-filesystem write is covered by the
  test described above instead.

None of that is a person forming an opinion about whether the thing is any good
to use, which is what the criterion is for. **Do not mark it satisfied.**

**And the branch's final review produced direct evidence of what it is for.**
`<TextEntry>` kept the *head* of its cursor line, so a title longer than the 67
columns the value field gets at width 80 drew as head-plus-ellipsis with no
cursor at all, and every keystroke after that was invisible. Two of this
repository's own 26 issues have titles of 68 and 70 characters. A person opening
`tab` on either would have hit it in the first half-minute; the agent-driven run
landed on an issue whose title fits, and 289 tests had nothing to say. The
display bug is fixed — the entry now scrolls horizontally as well as vertically
— but what found it was reading the arithmetic, not using the thing.

One thing the run did surface, which no test would have: **the `?` overlay's
key column overflows on its longest entry.** `HelpOverlay` pads keys to 22 with
`padEnd`, which does not truncate, and
`enter / esc / q, in the issue view` is 34 characters — so that row renders as
`…in the issue viewback to the list — q does not quit`, with no space at all
between the two columns. Cosmetic, and **pre-2c**: both the entry and the
`padEnd(22)` are older than this plan — they came in with the browse commit,
confirmed by diffing this commit against its parent. Nothing in the suite looks
at the seam between the columns.

## Where the rest lives

| | |
| --- | --- |
| Toolchain, and the rules this project's defects earned | `CLAUDE.md` |
| Why it works the way it does | `README.md` |
| Designs, plans and spikes | `docs/superpowers/` |
| The backlog | `dz list`, `dz show <prefix>` |
