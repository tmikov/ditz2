# ditz2-ui, plan 2c: the form screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change an issue's fields without composing a command line. `Tab`
opens a form over the selected issue with five fields — title, type, status,
component, assignee — `Tab` and `Shift-Tab` move between them, the three
vocabulary fields are pickers, `Ctrl-S` saves through `set`, and `n` opens the
same form empty and saves through `add`.

**Architecture:** The form is one more row in `app.tsx`'s `overlays` table, not
a new screen: `UiState.overlay` gains `{kind:'form'}` and the reducer, the
keyboard handler and the two render slots all follow from that. Its values live
in one piece of component state, exactly as `draft` does and for the same
reason, and they are diffed against the issue the form opened over so that
`set` is handed only the fields the operator actually changed. Every write goes
through `write()` → `runMutation`, so the form inherits the lock wait, the
retry and the error overlay without deciding anything about them.

**Tech Stack:** TypeScript (NodeNext, strict), Ink 6.8.0, React 19.2.8,
`ink-testing-library` 4.0.0, vitest 2.1.9, npm workspaces.

---

## Rulings, so nobody re-litigates them mid-execution

Eight questions were raised against the draft of this plan and **all eight have
been decided by the human partner**. They are recorded here, with the reasoning
that was accepted, because each one is a place the spec or the code left a real
choice and every one of them is visible in the tasks below. The task that
carries each is named. Do not reopen these while executing; if one turns out to
be wrong, that is a finding to report, not a decision to retake.

1. **`add` mode has three fields, and the other two rows are absent rather
   than dimmed.** `NewIssue` is `{title, type, component?, body?}`;
   `createIssue` always produces an open, unassigned issue and the facade
   exposes no way to say otherwise. The rejected alternatives were following
   `add` with a second `set` — two locked operations where the spec promises
   one, and a half-created issue if the second fails — and drawing all five
   with two inert. **Accepted reasoning: a field that is drawn is a field the
   operator will try to fill in.** *(Tasks 3 and 6.)*

2. **`n` under an active filter creates the issue, selects it, and lets the
   existing machinery speak.** The save path dispatches `select` with the new
   id and `mutationSucceeded`'s `reselect` either lands the cursor on it or
   reports `<shortId> is no longer in the list`. That message reads oddly for
   something that never was in the list; **accepted as revisitable rather than
   fixed now**, because the alternative is a notice `mutationSucceeded` would
   have to stop clearing. *(Task 6.)*

3. **`set` and `add` share one screen**, as the spec says: one component, one
   keyboard branch, one `FormState`, differing only in the field list, the
   heading, and which facade call `Ctrl-S` makes. *(Tasks 4, 5 and 6.)*

4. **`Esc` discards a half-filled form**, matching `Esc` on the comment and
   close overlays, and the footer says `esc cancel`. What is kept is the other
   case: a form the facade *refused* comes back on the next `Tab` with the
   operator's edits in it, which is the rule `startDraft` already implements
   for the comment draft. *(Task 5.)*

5. **The field order is the spec's** — Title, Type, Status, Component,
   Assignee — with `Body` drawn last as an unfocusable one-line summary, so the
   operator can see that a save will not touch it. *(Task 4.)*

6. **`Ctrl-S` with nothing changed closes the form and says `no changes`,
   without taking the lock.** `setFields` refuses an empty patch and keeps that
   rule for every other caller; this only declines to contend with an agent in
   order to be told something the form already knows. *(Task 5.)*

7. **`SETTABLE_STATUSES` and `DEFAULT_ISSUE_TYPE` are exported from `ditz2`.**
   Accepted on the grounds the draft gave: the alternative is a second copy of
   a rule the facade already enforces, which is the `dz doctor` defect
   `CLAUDE.md` records. *(Task 1.)*

8. **The footer is solved for 2c *and* 2d now, not just for 2c.** The draft
   proposed shipping at 78 of 80 columns and leaving plan 2d to find room for
   its `$EDITOR` key. **Rejected**: this is the second time the footer has hit
   the ceiling, the first time cost an unplanned fix round and silently killed
   an assertion nobody noticed for two rounds, and a two-column margin is that
   trap set again. The requirements are that `LIST_KEYS` and everything derived
   from it fit 80 **with room to spare** once 2c's keys *and* a placeholder for
   2d's are counted; that the standing rule holds — every working binding
   appears and nothing appears that does not; that the derivation of
   `ERROR_KEYS` from `LIST_KEYS` is kept, since it is what made this visible
   both times; and that **a test pins the projected post-2d width now**, ahead
   of the feature, so 2d inherits a budget it cannot silently blow. *(Task 2,
   which measures the alternatives and concludes that a second footer line is
   the only one that leaves room rather than borrowing it.)*

## Where the code contradicted the brief

Checked against `ui/src/app.tsx`, `ui/src/state.ts`, `ui/src/components/` and
`src/api/` on 2026-09-02, at `53cdaffde65f`. Everything else the brief asserted
holds; these four did not, and the plan is written against the code.

- **`add` does not take five fields.** `NewIssue` is
  `{title: string; type: string; component?: string | null; body?: string}`
  (`src/api/write.ts:28`). Status and assignee are not settable at creation.
  Ruling 1 decides what the form does about it.

- **`STATUSES` includes `closed`, which `set` refuses.** `assertSettableStatus`
  raises `INVALID_FIELD` for it, pointing at `dz close`. A status picker built
  from `STATUSES` would therefore offer an option the save cannot take. There
  is no exported runtime list of the settable ones — `SettableStatus` is a
  type — so Task 1 derives and exports one rather than letting the UI filter
  `closed` out for itself, which would be the second copy of a rule
  `CLAUDE.md` forbids.

- **`set` appends a log entry for every field it is given, changed or not.**
  Not inferred from reading `setField`; measured against the built `dz`:

  ```
  $ dz set <id> --title 'a title' --type task     # both already those values
  $ dz show <id> --json | …log
  created | null
  title   | a title -> a title
  type    | task -> task
  ```

  So a form that sends all five fields writes four lies into the log on every
  save. The form must send a diff, and Task 3 is where that lives.

- **`set` has no compare-and-swap.** `setFields` re-reads the issue under the
  lock and applies what it was handed; only `saveEdited` compares a baseline.
  The spec's claim that "every write re-reads and re-validates under the lock,
  so a stale view produces a refused write, never a silent overwrite" is true
  of `edit` and not of `set`. Sending only the changed fields narrows the
  window to the fields the operator meant to change, which is the best this
  plan can do without a baseline in the facade.

Two more things the brief did not mention and the plan depends on:

- **`app.tsx`'s overlay render is now one table**, `overlays: Record<OverlayKind,
  OverlaySlots>`, landed in `53cdaffde65f`. `OverlayKind` is derived from
  `UiState['overlay']`, so adding `{kind: 'form'}` to the reducer's union
  **fails to compile until the table has a `form` row**. That is the strongest
  guarantee in this plan and Task 4 leans on it.

- **The formatter and the linter currently check nothing in this project** — no
  eslint configuration exists in either workspace, verified on
  2026-09-02 and recorded in `HANDOFF.md`. They are still run, because
  `CLAUDE.md` requires it and because that will change. **`npm run typecheck`
  is the static gate that actually fails**, and no step in this plan may treat
  a clean lint run as evidence of anything.

## Global Constraints

Carried from `docs/superpowers/specs/2026-08-25-ditz2-tui-design.md`, plan 2b
and `CLAUDE.md`. Every task's requirements implicitly include this section.

- **`lockTimeoutMs: 0`, always.** `ui/src/index.tsx` sets it and must keep it.
  Plan 2b's pty test is what proves it; nothing here may make the facade sleep.
- **`ditz2-ui` imports `ditz2` by bare specifier only.** No reaching into
  `core/`, `store/` or `render/`. Anything the UI needs from those is exported
  through `src/api/index.ts` first — Task 1 does exactly that.
- **Vocabularies are imported, never retyped.** `ISSUE_TYPES`, `RESOLUTIONS`,
  `STATUSES` and (after Task 1) `SETTABLE_STATUSES` and `DEFAULT_ISSUE_TYPE`
  come from `ditz2`; components come from `project.components.list()`.
- **The snapshot is reloaded after a successful write**, with `SNAPSHOT_FILTER`
  (`{all: true}`), never patched from a returned `Issue`. `runMutation` already
  does this and no code in this plan may do it a second time.
- **Selection is tracked by issue id, never by list index.**
- **Every write goes through `write()` in `app.tsx`**, which wraps
  `runMutation` and stores the retry thunk. Nothing else decides what `LOCKED`
  means.
- **A test that cannot fail is a defect.** Plan 2b shipped eight of them. After
  writing a test, break the code it covers and watch it fail; a breakage that
  refuses to fire is a finding to report, not a box to tick.
- **Never claim an invariant a comment cannot back.**
- Toolchain: any Node >= 20 and the public npm registry.
- **`git add` new files BEFORE running any checks** — a checker that reads the
  changeset cannot see an untracked file.
- Commit messages: `ditz2-ui: <what changed>` for `ui/`, `ditz2:` elsewhere.
- New files: the 6-line MIT header, one trailing newline and no empty line
  after it (`tail -c 1 <f> | od -An -tx1` prints `0a`), unix line endings, and
  **no raw control bytes** — a literal ESC byte written into a source file
  looks like ordinary text and does not survive a copy-paste, so spell it
  `String.fromCharCode(27)`, or as a \u escape inside a string literal.
- Comment only non-obvious invariants. Do not restate what the code does.
- Formatter and linter before committing, knowing what they are worth (above).
- **`npm run test:all` is the gate and its exit code is meaningful** only
  because it invokes `tsc` and `vitest` directly. npm 8.19.4 discards the exit
  status of workspace-member scripts. Do not "simplify" it back to
  `npm run test --workspace ditz2-ui`. Read `echo $?`, not the log.
- Never use bash `grep`/`find`/`rg` — recursive traversal here times out.
  Reading a known file with `node -e` is fine and is how the scans below work.

## Decisions this plan inherits

- **`Tab` opens the form, not `Enter`.** `Enter` opens and closes the
  full-screen reader; `e` is reserved for plan 2d's `$EDITOR`. Whatever this
  plan binds, the footer and the `?` overlay must both name it: there is a test
  refusing a footer that advertises a dead key (`app-keys.test.tsx`'s
  *advertises the bindings that work, and only those*, whose
  `not.toContain('enter edit')` is a forward guard written for this plan) and
  the same test's positive half, which today asserts `c/x comment/close` and
  after Task 2 asserts `c comment` and `x close` separately.
- **`Picker.tsx` is reused as-is** — `options`, `selected`, `width`, `dim` —
  and `moveSelection` clamps rather than wraps. Nothing in this plan edits it.
- **`TextEntry.tsx` owns the editing rules.** `handleEntryKey(lines, input,
  key)` is the one place that decides that Enter is a newline, that backspace
  joins lines and that control characters are not text. The form's typed fields
  route through it; Task 3 adds the single-line variant rather than a second
  handler beside it.
- **The close overlay's two-field `Tab` model is what this generalises**, and
  its two rulings come with it: the arrow keys are handled *inside* the focus
  check, and the form's values and its focus are cleared in exactly one place.
- **`draftFor` is `{id, kind}`** because a draft belongs to the issue *and* the
  overlay it was typed in. The form's equivalent is structural: `FormState`
  carries its own mode and its own issue, so "the same form on the same issue"
  is a comparison against the state itself rather than a parallel key.
- **`runMutation` is the write path**, `LOCKED` is a wait with a retry, and
  anything that is not a `DzError` is a bug in this package and is rethrown.
- **An overlay refuses to open rather than overflow.** `x` compares
  `listRows + detailRows` against `CLOSE_OVERLAY_ROWS` and says
  `CLOSE_TOO_SHORT`. The form does the same against its own floor, against the
  *same* budget — `HANDOFF.md` records that this boundary is deliberately one
  row conservative and that computing a looser one for a single overlay would
  be a second rule to keep true.

## What already exists

Read these before starting.

| | |
| --- | --- |
| The approved design | `docs/superpowers/specs/2026-08-25-ditz2-tui-design.md` |
| The plan this one continues, and its five documented errors | `docs/superpowers/plans/2026-08-30-ditz2-ui-write.md` |
| Current state, the rulings that override that plan, and the parked findings | `HANDOFF.md` |
| The rules this project's defects earned | `CLAUDE.md` |
| Plan 2d's spike, already done | `docs/superpowers/spikes/2026-08-30-ink-editor-suspend.md` |

Facts the tasks below depend on, all verified rather than remembered:

- `Project.add(fields: NewIssue): Issue` and
  `Project.set(prefix: string, fields: EditableFields): Issue`. Both take the
  project lock internally and throw `DzError` with typed codes.
  `EditableFields` is `{status?, title?, type?, component?: string|null,
  assignee?: string|null}` — all optional, and `null` clears.
- `Project.components.list(): string[]` reads `dz/config.yaml` on each call.
- Ink 6.8.0 reports Shift-Tab as `key.tab && key.shift` (`\u001B[Z` →
  `keyName['[Z'] = 'tab'`, `isShiftKey('[Z')` true), and gives `input === ''`
  for both Tab and Shift-Tab because `tab` is in `nonAlphanumericKeys`. So
  `handleEntryKey` already returns `null` for both and no text field can
  swallow them. Read from `node_modules/ink/build/parse-keypress.js`.
- `ui/tests/helpers.tsx`'s `stubProject` has `components: {list: reject, …}`,
  where `reject` throws *unexpected project call*. **Any test that opens the
  form must override it**, and `ui/tests/app-keys.test.tsx` carries its own
  near-copy of the same stub that must be overridden separately.
- `helpers.tsx`'s `mount` renders at `rows={14}`, which is **below the form's
  floor**; the form's tests need their own `mount` at 20 rows, the way
  `app-filter.test.tsx` already does for the help overlay.
- The three-issue fixture: `alpha` (bug, component `cli`), `beta` (feature,
  component `store`), `gamma` (task, **no component**, status `in-progress`).

## File structure

**Created:**

| File | Responsibility |
| --- | --- |
| `ui/src/form.ts` | the form's vocabulary, values, focus ring and diff — pure, no React |
| `ui/src/components/FormOverlay.tsx` | the layout, and the floor App refuses below |
| `ui/tests/form-model.test.ts` | `ui/src/form.ts` |
| `ui/tests/form-view.test.tsx` | `FormOverlay` rendered from props |
| `ui/tests/form.test.tsx` | keys, focus, `set` and `add` through `<App>` |

**Modified:**

| File | Responsibility |
| --- | --- |
| `src/core/validate.ts` | derives and exports `SETTABLE_STATUSES` |
| `src/core/types.ts` | `DEFAULT_ISSUE_TYPE` |
| `src/cli/add.ts` | uses it, so the two front-ends cannot disagree |
| `src/api/index.ts` | re-exports both |
| `ui/src/state.ts` | the `form` overlay kind, `openForm`, `select` |
| `ui/src/components/TextEntry.tsx` | `handleLineKey`, the single-line rule |
| `ui/src/components/Chrome.tsx` | `FOOTER_ROWS`, and a footer of that many lines |
| `ui/src/app.tsx` | the two-line footers, the `form` row, the keyboard branch, `tab`/`n` |
| `ui/src/components/HelpOverlay.tsx` | the new bindings |
| `ui/tests/helpers.tsx` | `footerOf` (Task 2), `noticeOf` (Task 6, with its first caller), `KEY.shiftTab`, a stub that lists components |
| `ui/tests/app-keys.test.tsx`, `comment.test.tsx`, `close.test.tsx`, `issue-view.test.tsx`, `waiting.test.tsx`, `app-filter.test.tsx` | recalibrated, each with the reason recorded |
| `ui/tests/e2e.test.ts` | `set` and `add` through the built binary |
| `ui/README.md`, `HANDOFF.md` | what the UI now does |

---

### Task 1: The statuses `set` accepts, exported

The form's status picker must offer exactly what `set` will take. `STATUSES`
includes `closed`, which it will not. `SettableStatus` is the type that says so
and a type cannot be iterated, so this task derives the runtime list beside the
function that enforces the rule and exports it. `DEFAULT_ISSUE_TYPE` rides
along for the same reason: `dz add` defaults `--type` to the string `'task'`
today, and a `n` form that starts on a different type would be two front-ends
disagreeing about a default nobody wrote down.

Nothing in `ui/` changes here. This task ships on its own.

**Files:**
- Modify: `src/core/validate.ts`, `src/core/types.ts`, `src/cli/add.ts`,
  `src/api/index.ts`
- Test: `src/core/validate.test.ts`, `src/api/api.test.ts`

**Interfaces:**
- Produces: `SETTABLE_STATUSES: readonly SettableStatus[]` and
  `DEFAULT_ISSUE_TYPE: IssueType`, both re-exported from `ditz2`.
- Consumed by: Task 3's `choicesFor` and `EMPTY_VALUES`.

- [x] **Step 1: Write the failing tests**

Append to `src/core/validate.test.ts`, and add `SETTABLE_STATUSES` to its
existing import from `./validate.js` and `STATUSES` to a new import from
`./types.js`:

```ts
describe('SETTABLE_STATUSES', () => {
  it('is exactly the statuses assertSettableStatus accepts', () => {
    // Pinned from both sides on purpose. Asserting only that `closed` is
    // absent would pass for an empty list, and asserting only that each
    // member is accepted would pass for a list that had quietly lost
    // `in-progress` — which is the failure a UI picker would show as a
    // missing option nobody could choose.
    //
    // No separate "every element is a real status" test exists: given
    // assertSettableStatus's own vocabulary check against STATUSES, any
    // element here that were not a real status would already fail the first
    // loop above (it would throw), so that assertion would never fail on its
    // own — it would only ever restate this one. See the comment on
    // SETTABLE_STATUSES in validate.ts for why that property is enforced by
    // review instead.
    expect(SETTABLE_STATUSES.length).toBeGreaterThan(0);
    for (const status of SETTABLE_STATUSES) {
      expect(() => { assertSettableStatus(status); }).not.toThrow();
    }
    for (const status of STATUSES.filter((s) => !SETTABLE_STATUSES.includes(s as never))) {
      expect(() => { assertSettableStatus(status); }).toThrow(DzError);
    }
  });
});
```

**Revision, made after implementation and review (see Step 6 below):** the
draft above originally specified a second test, *is derived from STATUSES
rather than written out again*, asserting `STATUSES.includes(status)` for
every `status` in `SETTABLE_STATUSES`. It was removed. "Derived rather than
retyped" is not a runtime-observable property: a hand-written list that
matches today's `STATUSES.filter(...)` output produces an identical value, so
no assertion over that value can tell the two apart. And for any list that
does *not* match — the case the test could catch — `assertSettableStatus`'s
own `validateEnum(next, STATUSES, 'status')` check already throws for every
element not in `STATUSES`, which the first test's first loop already asserts
`.not.toThrow()` against. So the second test's failure is a strict subset of
the first test's: proven, not just observed, since `'closed' ∈ STATUSES`
guarantees any `SETTABLE_STATUSES` element outside `STATUSES` is `≠ 'closed'`
and therefore reaches `validateEnum` and throws. The derivation is enforced by
review and recorded in a comment on `SETTABLE_STATUSES` instead of a test that
could only ever restate the code it was checking.

and to `src/api/api.test.ts`, wherever it already asserts about the public
surface:

```ts
  it('publishes the vocabularies a consumer would otherwise retype', () => {
    // ditz2-ui builds its pickers from these. Anything it cannot import it
    // would have to spell for itself, and a UI offering a value the facade
    // rejects is a form that cannot be saved.
    expect(api.SETTABLE_STATUSES).not.toContain('closed');
    expect(api.ISSUE_TYPES).toContain(api.DEFAULT_ISSUE_TYPE);
  });
```

- [x] **Step 2: Run them and watch them fail**

```bash
npx vitest run src/core/validate.test.ts src/api/api.test.ts
```

Expected: FAIL — `SETTABLE_STATUSES` and `DEFAULT_ISSUE_TYPE` do not exist.

- [x] **Step 3: Derive the list in `src/core/validate.ts`**

Replace the existing `assertSettableStatus` and the type above it with:

```ts
/** Statuses `set --status` will accept. Closing needs a resolution, so it is excluded. */
export type SettableStatus = Exclude<Status, 'closed'>;

/**
 * The one status `set` refuses, spelled once.
 *
 * The list below and the check beneath it have to agree, and the way they
 * agree is by both reading this rather than each naming `closed` for itself.
 */
const UNSETTABLE: Status = 'closed';

/**
 * The same rule as a list, for a caller that has to offer a choice.
 *
 * That this line computes the list rather than spelling it out is a property
 * no test can observe: any wrong element either happens to equal what the
 * filter would have produced (so it isn't wrong) or is rejected by
 * `assertSettableStatus`, which `validate.test.ts` already checks — a second
 * test asserting "no element here is wrong" would have to recompute this
 * same filter to compare against, i.e. rewrite this line to check it.
 * Keeping the derivation, not adding a test for it, is what review is for.
 */
export const SETTABLE_STATUSES: readonly SettableStatus[] =
  STATUSES.filter((s): s is SettableStatus => s !== UNSETTABLE);

export function assertSettableStatus(next: string): asserts next is SettableStatus {
  if (next === UNSETTABLE) {
    throw new DzError(
      'INVALID_FIELD',
      "cannot set status to 'closed' with 'set', because that would leave the resolution empty; " +
        'use `dz close <id> --as <fixed|wontfix|duplicate>` instead',
    );
  }
  validateEnum(next, STATUSES, 'status');
}
```

The `validateEnum` call keeps `STATUSES`, not the new list: its message names
what a status *is*, and narrowing it would change the wording of an error the
CLI tests already assert. If any of them fail, that is the finding — report it
rather than editing the assertion.

- [x] **Step 4: `DEFAULT_ISSUE_TYPE`, and the CLI reading it**

In `src/core/types.ts`, under `ISSUE_TYPES`:

```ts
/** What `dz add` and any other front-end assume when nobody says. */
export const DEFAULT_ISSUE_TYPE: IssueType = 'task';
```

In `src/cli/add.ts`, import it and replace the literal default:

```ts
    .option('--type <type>', `one of ${ISSUE_TYPES.join('|')}`, DEFAULT_ISSUE_TYPE)
```

This is deliberately not a behaviour change — the value is the same string the
option already carried — and the existing `tests/cli/add-show.test.ts` must
keep passing untouched. That it does is the evidence the extraction was
faithful.

In `src/api/index.ts`, extend the vocabulary re-export:

```ts
export { DEFAULT_ISSUE_TYPE, ISSUE_TYPES, RESOLUTIONS, STATUSES } from '../core/types.js';
export { SETTABLE_STATUSES } from '../core/validate.js';
export type { SettableStatus } from '../core/validate.js';
```

- [x] **Step 5: Run and watch them pass**

```bash
npx vitest run src && npm run typecheck
```

- [x] **Step 6: Prove the checks can fail**

1. Define `SETTABLE_STATUSES` as `STATUSES` (drop the filter). *is exactly the
   statuses assertSettableStatus accepts* must fail on the first loop, at
   `status === 'closed'`, because `assertSettableStatus` throws there.
2. Define it as `['open']`. The same test must fail on the **second** loop:
   `in-progress` is then expected to throw and does not. Both loops matter and
   this shows each catching a different mistake.
3. Add `'reopened'` to `SETTABLE_STATUSES` (or append a case-mangled value
   like `'Closed'`, or reassign the whole thing to `STATUSES`). This step was
   run and its outcome changed the plan: every mutation that put an element
   outside `STATUSES` into the list also failed the first test's first loop
   (`assertSettableStatus` rejects it via `validateEnum`), and this is not a
   coincidence of the examples tried — `'closed' ∈ STATUSES` guarantees any
   out-of-vocabulary element is `≠ 'closed'`, so it always reaches
   `validateEnum` and throws. A second test asserting "is derived from
   STATUSES" therefore can never fail on its own; it was removed, and the
   property it named is now a comment on `SETTABLE_STATUSES` instead. (The
   `STATUSES`-reassignment mutation, by contrast, fails only the first test
   and not this removed one, which is further evidence the two tests were
   never independent axes.)
4. Change `DEFAULT_ISSUE_TYPE` to `'nonsense'`. The api test must fail on
   `ISSUE_TYPES` not containing it. **This one is worth checking twice**: it
   only fires because the assertion compares against the vocabulary rather
   than against the literal `'task'`, which would have been the natural way to
   write it and would have tested nothing but itself.

- [x] **Step 7: Lint and commit**

```bash
git commit src -m "ditz2: export the statuses set accepts, and add's default type"
```

### Task 2: The footer, in two lines

**This task is the human partner's ruling on open question 8**, and it is
larger than the version this plan first proposed. That version bought thirteen
columns by moving `esc dismiss` onto the status line and spent eleven of them
immediately, shipping at 78 of 80 and leaving plan 2d to find room for `e`.
That was rejected: the footer has hit the ceiling twice, the first time cost an
unplanned fix round and silently killed an assertion nobody noticed for two
rounds, and a two-column margin is the same trap set again.

**Measured first, because the conclusion is forced rather than chosen.** Ten
bindings have to appear on the list screen once plan 2d lands — `up/down`,
`tab`, `n`, `c`, `x`, `e`, `/`, `r`, `?`, `q` — and every one-line packing of
them that is still readable overruns the 80-column fixture:

| packing | length |
| --- | --- |
| `up/down move  tab/n edit/new  c/x comment/close  e body  / filter  r reload  ? help  q quit` | 91 |
| the same with the verb dropped from `up/down` | 86 |
| with `tab/n/e edit/new/body` zipped three ways | 85 |
| and `r/?/q reload/help/quit` zipped as well | 83 |

Eighty is not reachable, and the last row is already a footer nobody can read
at a glance. **So the footer becomes two lines**, which is the only change that
leaves room rather than borrowing it:

| constant | line | length |
| --- | --- | --- |
| `LIST_KEYS[0]` | `up/down move  / filter  r reload  ? help  q quit` | 48 |
| `LIST_KEYS[1]`, after **this task** | `c comment  x close` | 18 |
| `LIST_KEYS[1]`, after **Task 5** | `tab edit  n new  c comment  x close` | 35 |
| `LIST_KEYS[1]`, projected after 2d | `tab edit  n new  c comment  x close  e body` | 43 |
| `ERROR_KEYS[0]` = `` `esc dismiss  ${LIST_KEYS[0]}` `` | | **61** |
| `ISSUE_KEYS[0]` | | 62 |
| `COMMENT_KEYS[0]` | | 53 |
| `CLOSE_KEYS[0]` | | 51 |
| `FORM_KEYS[0]` (Task 5) | | 54 |
| `WAITING_KEYS[0]` | | 22 |

The widest footer line in the project is `ISSUE_KEYS[0]` at 62 of 80, and the
widest *composed* one — the only kind that can grow without anyone editing it,
and the one that has hit the ceiling twice — becomes `ERROR_KEYS[0]` at 61,
with nineteen columns spare. The line 2d has to grow is the 43 one. Three
further consequences, all improvements:

- **`ERROR_KEYS` stays, and stays composed from `LIST_KEYS`.** The ruling is
  explicit that the derivation is what made this visible both times, and at 61
  columns the prefix now fits with room. `esc dismiss` does **not** move to the
  status line; `<Notice>` is untouched by this plan.
- **`c/x comment/close` un-zips** into `c comment  x close`. The zip existed
  only because one line had no room for two entries.
- **`up/down move` keeps its verb**, which the one-line version had to spend.

**This task builds the second line and leaves it holding `c comment  x close`
only. `tab edit  n new` belongs to Task 5**, which is the task that makes
`Tab` and `n` do anything. Advertising them here would put two dead keys in
the footer, which is the half of the global constraint that is easiest to
break and the exact defect plan 2a shipped in reverse — it wrote
`not.toContain('c comment')` while `c` did nothing, and enforcing that stale
assertion once `c` worked cost an unplanned fix round two plans later. So
this task asserts their **absence** in *advertises the bindings that work, and
only those*, and Task 5's Step 8 flips those assertions in the same commit
that binds the keys. The projection test derives from `LIST_KEYS`, so it
re-measures itself when the line grows from 18 to 35 and nobody has to
remember to update it.

The cost is one row of body on every screen: `CHROME_ROWS` becomes
`2 + FOOTER_ROWS`. Every footer draws the same number of lines, padding when it
has fewer, so an overlay with a short footer is handed the same budget as the
list — the property the close overlay's floor already leans on, and the reason
this is not "two lines on the list screen only".

**Files:**
- Modify: `ui/src/components/Chrome.tsx`, `ui/src/app.tsx`, `ui/tests/helpers.tsx`
- Test: `ui/tests/app-keys.test.tsx`, and the `at(-1)` footer assertions in
  `ui/tests/comment.test.tsx`, `ui/tests/close.test.tsx`,
  `ui/tests/issue-view.test.tsx`, `ui/tests/waiting.test.tsx`,
  `ui/tests/app-filter.test.tsx`

**Interfaces:**
- `<Footer keys={readonly string[]} width={number} />`, one entry per line.
- `FOOTER_ROWS` is exported from `Chrome.tsx`; `app.tsx` computes
  `CHROME_ROWS = 2 + FOOTER_ROWS` from it rather than restating 4.
- `app.tsx` exports `LIST_KEYS` so the projection test derives from it instead
  of holding a second copy.
- `helpers.tsx` gains `footerOf(frame)`, sized from the exported `FOOTER_ROWS`,
  so no test hardcodes how many lines a footer has. A companion `noticeOf` was
  drafted here and dropped: this plan claimed it would replace `at(-2)` calls,
  and there is no `at(-2)` anywhere in `ui/`, so in this task it would have
  shipped with no caller. **Task 6 is its first real caller** — *says so when
  the active filter hides what was just created* — so Task 6 adds it, three
  lines, alongside the test that uses it.

- [x] **Step 1: Write the failing tests**

Add to `ui/tests/app-keys.test.tsx`, inside the `footer width` describe:

```tsx
  it('leaves room for the key plan 2d has not added yet', () => {
    // Deliberately ahead of the feature. `e` opens the body in $EDITOR and
    // does not exist; this is not a test of `e`. It is a test that the budget
    // 2d needs is already there, so that 2d discovers the ceiling here rather
    // than by clipping a footer in its own last task — which is how the
    // ceiling was found both previous times.
    //
    // Derived from the constant, never a copy of it: a projection that
    // quietly stopped describing the real footer would be worse than no
    // projection at all.
    const projected = `${LIST_KEYS[1]!}  e body`;
    expect(projected.length).toBeLessThanOrEqual(WIDTH);
    // Room to spare, and this is the assertion the ruling actually asked for.
    // The two additions before this one each fitted exactly, and each cost a
    // fix round; a bound of exactly WIDTH would pass in that same state.
    expect(projected.length).toBeLessThanOrEqual(WIDTH - 8);
  });

  it('pads a short footer so its last line always lands the same distance up', async () => {
    // What the padding buys is a stable position, not a stable body: nothing
    // in App measures how tall the footer drew, so a short one could never
    // have let the body grow. `footerOf` and every `at(-1)` assertion in the
    // suite depend on this and on nothing else about it.
    //
    // NOT "every footer is FOOTER_ROWS tall" — `/` swaps the footer slot for
    // <FilterField>, one unpadded <Text> that never reaches <Footer>, and
    // that frame is measurably a row shorter. Only screens drawing a <Footer>
    // are covered here, which is every screen but that one.
    //
    // Asserted on the padding itself, and not on `slice(-FOOTER_ROWS).length`
    // — that is FOOTER_ROWS for any frame at all and could not fail. The
    // comment overlay has one line of keys, so its frame ends in a blank row
    // with the keys above it; the list has two, so its last row is the second.
    const one = mount();
    try {
      await settle();
      await press(one.stdin, 'c');
      const frame = lines(one.lastFrame());
      expect(frame.at(-1)).toBe('');
      expect(frame.at(-FOOTER_ROWS)).toContain('^S save');
    } finally {
      one.unmount();
    }

    const two = mount();
    try {
      await settle();
      expect(lines(two.lastFrame()).at(-1)).toContain('c comment');
    } finally {
      two.unmount();
    }
  });
```

and rewrite the width sweep itself to measure every line of the footer rather
than only the last one:

```tsx
    it(`is readable to the end on ${name}`, async () => {
      const r = mount(over);
      try {
        await settle();
        await press(r.stdin, ...keys);
        const footer = lines(r.lastFrame()).slice(-FOOTER_ROWS);
        expect(footer.join('\n')).toContain(marker);
        for (const line of footer) {
          // The ellipsis check is the one that can fire today. `truncate`
          // appends '…' exactly when a string did not fit, so a footer line
          // ending in one is a binding being shown and withheld.
          expect(line.endsWith('…'), `${name}: ${line}`).toBe(false);
          // This one cannot fire while <Footer> truncates — `truncate` returns
          // at most `width`, so the length is capped before it gets here. Kept
          // because the two cover each other: drop the truncate and the
          // ellipsis stops appearing, at which point an over-wide footer is
          // caught by this and by nothing else.
          expect(line.length, `${name}: ${line}`).toBeLessThanOrEqual(WIDTH);
        }
      } finally {
        r.unmount();
      }
    });
```

The `a write failure` row stays in that table, and its marker stays
`esc dismiss`: with two lines the error footer is `ERROR_KEYS`, which is still
the composed string, and still the widest thing the sweep measures that no
single edit is responsible for. (`ISSUE_KEYS[0]` is wider at 62, but it is a
literal nobody derives, so it can only change when someone types into it.)

- [x] **Step 2: Run and watch them fail**

```bash
npx vitest run --root ui tests/app-keys.test.tsx
```

Expected: FAIL — `FOOTER_ROWS` and the exported `LIST_KEYS` do not exist, and
the footer is one line.

- [x] **Step 3: `<Footer>` draws a fixed number of lines**

In `ui/src/components/Chrome.tsx`, replacing the existing `Footer`:

```tsx
/**
 * The rows a `<Footer>` occupies, whatever it has to say.
 *
 * The number App reserves for the footer in `CHROME_ROWS`, and the number
 * `<Footer>` draws. They must agree, so `app.tsx` imports this rather than
 * restating it.
 *
 * What the padding buys is a **stable footer position**: the last row of the
 * frame is the footer's last line on every screen that draws a `<Footer>`,
 * whether that footer has one entry or two. `footerOf` and every `at(-1)`
 * assertion in the suite rest on exactly that, and without it each of them
 * would have to know which screen it was looking at.
 *
 * It does NOT stop the body growing into a short footer, and no comment here
 * should say it does: `listRows` and `detailRows` come from `rows` and the
 * chrome constants alone, and nothing measures how tall the footer actually
 * drew. Nor is `FOOTER_ROWS` true of every screen — `/` replaces the footer
 * slot with `<FilterField>`, which is one unpadded `<Text>` and does not come
 * through here at all, so that frame is a row shorter than the reservation.
 * That is fine and deliberate, for the reason `listRows` already gives about
 * `<Notice>`: the reservation is an upper bound, and erring a row short wastes
 * a line while erring a row long makes Ink scroll the frame.
 *
 * Two, because ten list-screen bindings do not fit in eighty columns on one
 * line. The measurements are in plan 2c, task 2.
 */
export const FOOTER_ROWS = 2;

/**
 * One entry per line.
 *
 * Short footers are padded; long ones are NOT truncated. The no-truncation
 * half is the load-bearing one: a third line overflows the height App
 * reserved, and letting it draw is what makes the frame-height sweep report
 * it — silently dropping it would hide a binding instead. Verified by
 * breakage, not asserted: clamping to `FOOTER_ROWS` and adding a third entry
 * fails nothing in the suite.
 */
export function Footer(
  { keys, width }: { keys: readonly string[]; width: number },
): React.ReactElement {
  const shown = [...keys];
  while (shown.length < FOOTER_ROWS) shown.push('');
  return (
    <Box flexDirection="column">
      {shown.map((line, n) => (
        // Positional slots, not identified rows.
        // eslint-disable-next-line react/no-array-index-key
        <Text key={n} dimColor wrap="truncate">{truncate(line, width) || ' '}</Text>
      ))}
    </Box>
  );
}
```

`Box` joins the imports from `ink` in that file.

- [x] **Step 4: The constants, in `app.tsx`**

```tsx
// Two lines, because ten list-screen bindings will not fit in eighty columns
// on one. The first is what you can do without changing anything; the second
// is everything that writes, and it is the line Task 5's `tab edit  n new`
// and plan 2d's `e body` grow. `c comment  x close` is deliberately un-zipped
// now that there is room: `c/x comment/close` existed only because one line
// had none.
export const LIST_KEYS: readonly string[] = [
  'up/down move  / filter  r reload  ? help  q quit',
  'c comment  x close',
];
const ISSUE_KEYS = ['up/down scroll  g/G top/bottom  enter/esc back  ? help  q back'];
const COMMENT_KEYS = ['type your comment  enter newline  ^S save  esc cancel'];
const CLOSE_KEYS = ['tab field  up/down resolution  ^S close  esc cancel'];
// Exactly the three keys the waiting branch of useInput answers. Nothing else
// reaches the list underneath while the wait is up, so nothing else may be
// advertised here — notably not `r reload`, which `r` no longer means.
const WAITING_KEYS = ['r retry  esc/q give up'];
// The list beneath an error stays exactly as interactive as the plain list
// screen, so this is LIST_KEYS with the one binding the error overlay adds —
// composed, not hand-copied. Composing is what has caught the footer running
// out of room both times it has; at 61 columns there is now room to compose
// into.
//
// Spread rather than indexed line by line: naming LIST_KEYS[1] explicitly
// would silently drop a third line if one were ever added, which is the exact
// drift composing exists to prevent.
const ERROR_KEYS: readonly string[] = [
  `esc dismiss  ${LIST_KEYS[0]}`,
  ...LIST_KEYS.slice(1),
];
```

and the chrome:

```tsx
/** Header, status line, and the footer's own rows. */
const CHROME_ROWS = 2 + FOOTER_ROWS;
```

`FOOTER_ROWS` is imported from `./components/Chrome.js` rather than spelled as
`4` here: the two must agree, so one reads the other.

**Nothing else in `app.tsx` changes in this task.** The `overlays` table, the
`errorActive` predicate and every `<Footer keys={…} />` call site keep working,
because the prop went from a string to an array of them and each constant went
with it.

- [x] **Step 5: The test helpers, so no test counts footer rows itself**

In `ui/tests/helpers.tsx`:

```tsx
import { FOOTER_ROWS } from '../src/components/Chrome.js';

/** The footer, however many lines it has, as one string. */
export function footerOf(frame: string | undefined): string {
  return lines(frame).slice(-FOOTER_ROWS).join('\n');
}
```

Sized from the exported constant. A test that spelled `slice(-2)` would keep
passing against a three-line footer while measuring the wrong two lines, which
is the class of check this project keeps paying for.

**`noticeOf` is deliberately not added here.** An earlier revision of this task
specified it alongside `footerOf`, on the premise that it replaced existing
`at(-2)` status-line reads. There are none — the string does not occur
anywhere under `ui/` — so in this task it would have been an exported helper
with no caller, carried through five reviews on a speculative future. Its
first real caller is Task 6's *says so when the active filter hides what was
just created*, so **Task 6 adds it**:

```tsx
/**
 * The status line, which sits directly above the footer.
 *
 * Returns the last body line when <Notice> drew nothing, since <Notice>
 * renders null rather than a blank row.
 */
export function noticeOf(frame: string | undefined): string {
  return lines(frame).at(-FOOTER_ROWS - 1) ?? '';
}
```

- [x] **Step 6: Recalibrate every footer assertion in the suite**

Each is a positional index that has stopped pointing at the footer, not an
assertion whose meaning changed. Replace the index, keep the words:

| file | was | becomes |
| --- | --- | --- |
| `app-keys.test.tsx` *advertises the bindings* | `lines(lastFrame()).at(-1)` | `footerOf(lastFrame())` |
| `comment.test.tsx` *opens on c* | `at(-1)` | `footerOf(...)` |
| `comment.test.tsx` *dismisses the error on Esc* | `at(-1)` | `footerOf(...)` |
| `comment.test.tsx` *does not carry the error footer* | `at(-1)` | `footerOf(...)` |
| `close.test.tsx` *opens on x* | `at(-1)` | `footerOf(...)` |
| `close.test.tsx` *the close footer* | `at(-1)` | `footerOf(...)` |
| `issue-view.test.tsx` (two) | `at(-1)` | `footerOf(...)` |
| `waiting.test.tsx` | `at(-1)` | `footerOf(...)` |
| `app-filter.test.tsx` *stays inside a short terminal* | `frame.at(-1)` | `footerOf(lastFrame())` |

Eleven sites, not eight: *opens on c and shows the issue it will comment on*
and *opens on x and shows the issue it will close* each read `at(-1)` too, and
each goes red without the change, because a one-line footer padded to two puts
the blank row last.

In *advertises the bindings that work, and only those*, three assertions are
not positional and do change:

```tsx
    // Un-zipped, now that a second footer line has room for both spelled out.
    // Two assertions are as strong as the one zipped string was: a footer
    // naming `c` and forgetting `x` fails the second.
    expect(footer).toContain('c comment');
    expect(footer).toContain('x close');
    // Plan 2c adds these, and until it does the footer must not claim them.
    // `tab` and `n` are the keys it settled on — `enter` is the full-screen
    // reader's, both to open and to close — and neither does anything on the
    // list screen yet, so all three stay out. Task 5 flips the two new ones
    // in the same commit that binds the keys.
    expect(footer).not.toContain('enter edit');
    expect(footer).not.toContain('tab edit');
    expect(footer).not.toContain('n new');
```

`CHROME_ROWS` growing by one also moves two documented boundaries, and both are
recorded numbers rather than derived ones:

- The close overlay refuses below `rows = 13` instead of `12`; `minRows: 12` in
  the frame-height sweep becomes `13`, and its comment — which now says which
  unit each number is counted in — must say `13`. `HANDOFF.md` records that
  boundary too, in the `CloseOverlay` item; Task 7's documentation step
  corrects it there.
- `HEIGHTS` gains `13`, so the new boundary is swept the way `12` swept the old
  one.
- **The page size changes**, because `listRows` is derived from `CHROME_ROWS`:
  at `app-keys.test.tsx`'s `rows={21}` paging fixture it goes from
  `floor(17 × 0.6) = 10` to `floor(16 × 0.6) = 9`, so *pages by exactly one
  screen, not to the end* lands on different issues. Re-derive its expectations
  from the formula in its own comment — that comment explains why 21 was
  chosen to make the arithmetic land on a round number, and the number it
  lands on is no longer round. Changing the fixture height to keep the round
  number is the better fix if one exists; say which you did. **It exists and
  was taken: `rows` moves 21 → 22**, since
  `floor((22 − 4 − 1) × 0.6) = floor(17 × 0.6) = 10` is the same 17 the old 21
  gave, so `listRows` stays 10 and the `issue 10 / 20 / 10` expectations do not
  move at all. The comment also gains the `DETAIL_BORDER_ROWS` term it had
  silently dropped while claiming to state the arithmetic.
- `maxHelpOffset` at `app-filter.test.tsx`'s twelve-row terminal changes,
  because the help overlay's budget is now `rows - 5 = 7`. **Derive it**; do
  not take a number from this plan. Task 5 changes `HELP_LINES` as well, so
  recalibrate both files' help-scroll counts once, after Task 5, and say in the
  commit which moved and why.

- [x] **Step 7: Run and watch them pass**

```bash
npx vitest run --root ui && npx tsc -p ui/tsconfig.test.json
```

The whole suite. This changes the height of every frame the UI draws.

- [x] **Step 8: Prove the checks can fail**

1. Make `Footer` truncate to `FOOTER_ROWS` with `keys.slice(0, FOOTER_ROWS)`
   instead of padding, and give `LIST_KEYS` a third line. **Nothing fails**,
   which is the reason the padding version does not slice: report it, and
   confirm that with padding the same third line instead fails the frame-height
   sweep on `the list`.
2. Leave `CHROME_ROWS` at 3 while the footer draws two lines. The frame-height
   sweep must fail — the frame is then one row taller than the budget — and it
   should fail on several screens at once. If it fails on none, the sweep has
   stopped measuring height and that is a much larger finding.
3. Add `  e body` to `LIST_KEYS[1]` now. **Nothing fails**, and that is the
   point of the projection test: it is checking the budget, not the binding.
   Then also add `  n new  c comment  x close` a second time to that line, so
   it passes 80, and confirm *leaves room for the key plan 2d has not added
   yet* fails on the `WIDTH - 8` bound before the plain `WIDTH` one.
4. Hand-copy `ERROR_KEYS` as a literal that omits `q quit`. *is readable to the
   end on a write failure* still passes — it only checks width — so check
   instead that *advertises the bindings* fails; if it does not, the error
   footer has no test of its content at all and that is a finding worth
   recording in `HANDOFF.md`.
5. Delete the padding loop from `Footer`. *gives every footer the same height,
   padding the short ones* must fail on `expect(frame.at(-1)).toBe('')` — the
   comment overlay's keys would then be the last row. Confirm the frame is
   also a row shorter, which is the thing that actually matters and which no
   assertion states directly.
6. Give `footerOf` a hardcoded `slice(-2)` and set `FOOTER_ROWS` to 3. The
   padding test still passes — it reads `FOOTER_ROWS` — but *advertises the
   bindings that work* must fail, because `footerOf` then returns the two
   padded blanks and finds no keys at all. That is the drift the helper reads
   the constant to prevent.

- [x] **Step 9: Lint and commit**

```bash
git commit ui -m "ditz2-ui: give the footer a second line, and room for two more plans"
```

### Task 3: The form's model

Everything the form knows that is not React: which fields each mode has, what
each picker offers, where focus goes next, and — the part that carries the most
risk — what to send to `set`. Pure, so it can be tested without a frame.

**Files:**
- Create: `ui/src/form.ts`, `ui/tests/form-model.test.ts`
- Modify: `ui/src/components/TextEntry.tsx`

**Interfaces:**
- Consumes: `DEFAULT_ISSUE_TYPE`, `ISSUE_TYPES`, `SETTABLE_STATUSES` and the
  types `EditableFields`, `Issue`, `NewIssue` from `'ditz2'`; `moveSelection`
  from `./components/Picker.js`.
- Produces: `FormMode`, `FormField`, `FormValues`, `FormChoices`,
  `SET_FIELDS`, `ADD_FIELDS`, `fieldsFor`, `valuesOf`, `EMPTY_VALUES`,
  `choicesFor`, `optionsFor`, `textOf`, `typeInto`, `componentLabel`,
  `NO_COMPONENT`, `indexOf`, `pick`, `moveFocus`, `changedFields`,
  `isUnchanged`, `newIssueFrom`; and `handleLineKey` from `TextEntry.tsx`.

- [x] **Step 1: Write the failing tests**

Create `ui/tests/form-model.test.ts`:

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import type { Key } from 'ink';
import { ISSUE_TYPES, SETTABLE_STATUSES } from 'ditz2';
import {
  ADD_FIELDS, EMPTY_VALUES, SET_FIELDS, changedFields, choicesFor, componentLabel,
  fieldsFor, indexOf, isUnchanged, moveFocus, newIssueFrom, optionsFor, pick,
  textOf, typeInto, valuesOf,
} from '../src/form.js';
import { handleLineKey } from '../src/components/TextEntry.js';
import { issue } from './fixtures.js';

const ID = '01a00000-0001-7000-8000-000000000001';
const ALPHA = issue({ id: ID, title: 'alpha', type: 'bug', component: 'cli' });
const CONFIGURED = ['cli', 'store'];
const CHOICES = choicesFor(ALPHA, CONFIGURED);

describe('the form model', () => {
  it('can send every field it offers', () => {
    // Ties the field list to the patch `set` takes. A field the form draws
    // and `changedFields` cannot produce is one the operator can edit and
    // then watch not be saved.
    const before = valuesOf(ALPHA);
    const after = {
      title: 'renamed', type: 'task', status: 'in-progress',
      component: 'store', assignee: 'jane',
    };
    expect(Object.keys(changedFields(before, after)).sort())
      .toEqual([...SET_FIELDS].sort());
  });

  it('sends only what changed', () => {
    const before = valuesOf(ALPHA);
    expect(changedFields(before, { ...before, title: 'renamed' }))
      .toEqual({ title: 'renamed' });
  });

  it('sends nothing at all when nothing changed', () => {
    const before = valuesOf(ALPHA);
    expect(changedFields(before, { ...before })).toEqual({});
    expect(isUnchanged(changedFields(before, { ...before }))).toBe(true);
  });

  it('clears an assignee with null rather than an empty string', () => {
    // '' is how a text field spells nothing; null is how the facade does.
    // setField('assignee', '') would write an empty assignee, which is not
    // the same as unassigned and shows up as one in every filter.
    const before = valuesOf(issue({ id: ID, title: 'alpha', assignee: 'jane' }));
    expect(changedFields(before, { ...before, assignee: '' })).toEqual({ assignee: null });
  });

  it('clears a component with null', () => {
    const before = valuesOf(ALPHA);
    expect(changedFields(before, { ...before, component: null })).toEqual({ component: null });
  });

  it('offers no component as the first choice', () => {
    const choices = choicesFor(ALPHA, CONFIGURED);
    expect(choices.component[0]).toBeNull();
    expect(componentLabel(choices.component[0] ?? null)).toBe('(none)');
    expect(optionsFor(choices, 'component')).toEqual(['(none)', 'cli', 'store']);
  });

  it('can show a component the config no longer lists', () => {
    // `component rm --force` leaves issues behind holding a component nobody
    // configures. Leaving it out of the picker marks the first option, so the
    // form would read `(none)` over an issue that has one — and a save of any
    // other field would then post that as a change nobody made.
    const orphan = issue({ id: ID, title: 'alpha', component: 'legacy' });
    const choices = choicesFor(orphan, CONFIGURED);
    expect(choices.component).toContain('legacy');
    expect(indexOf(valuesOf(orphan), choices, 'component')).toBeGreaterThanOrEqual(0);
  });

  it('can show a closed status without offering to set one', () => {
    // Same shape as the orphaned component, and the reason `set` refuses is
    // in the facade: closing needs a resolution.
    const closed = issue({ id: ID, title: 'alpha', status: 'closed', resolution: 'fixed' });
    const choices = choicesFor(closed, CONFIGURED);
    expect(choices.status).toContain('closed');
    expect(SETTABLE_STATUSES).not.toContain('closed');
    expect(indexOf(valuesOf(closed), choices, 'status')).toBeGreaterThanOrEqual(0);
  });

  it('moves a picker to the next option and stops at the ends', () => {
    const values = valuesOf(ALPHA);
    const choices = choicesFor(ALPHA, CONFIGURED);
    expect(pick(values, choices, 'type', 1).type).toBe(ISSUE_TYPES[1]);
    // Clamped, not wrapped: Picker's moveSelection decides that and this
    // reads it rather than repeating the rule.
    expect(pick(values, choices, 'type', -1).type).toBe(ISSUE_TYPES[0]);
  });

  it('leaves a typed field alone', () => {
    const values = valuesOf(ALPHA);
    const choices = choicesFor(ALPHA, CONFIGURED);
    expect(pick(values, choices, 'title', 1)).toBe(values);
    expect(optionsFor(choices, 'title')).toBeNull();
    expect(optionsFor(choices, 'assignee')).toBeNull();
  });

  it('sorts every field into exactly one of picked and typed', () => {
    // The keyboard handler asks `textOf`; the layout and the row budget ask
    // `optionsFor`. If they ever disagree about a field, that field either
    // cannot be edited or is edited two ways at once — and both are switches
    // over the same union, so nothing but this notices them drifting apart.
    for (const field of SET_FIELDS) {
      const picked = optionsFor(CHOICES, field) !== null;
      const typed = textOf(valuesOf(ALPHA), field) !== null;
      expect(picked, field).not.toBe(typed);
    }
  });

  it('puts typed text back where it came from, and nowhere else', () => {
    const values = valuesOf(ALPHA);
    expect(typeInto(values, 'title', 'x').title).toBe('x');
    expect(typeInto(values, 'assignee', 'jane').assignee).toBe('jane');
    // A picker field is not typed into: the handler never reaches here for
    // one, and if it did, silently rewriting a picked value would be worse.
    expect(typeInto(values, 'type', 'x')).toBe(values);
  });

  it('wraps focus in both directions', () => {
    // A ring, unlike the picker. Five fields with a dead end at each one
    // means reversing all the way back to reach the title.
    expect(moveFocus(SET_FIELDS, 'title', 1)).toBe('type');
    expect(moveFocus(SET_FIELDS, 'assignee', 1)).toBe('title');
    expect(moveFocus(SET_FIELDS, 'title', -1)).toBe('assignee');
  });

  it('omits from the new-issue form what add cannot carry', () => {
    expect(fieldsFor('add')).not.toContain('status');
    expect(fieldsFor('add')).not.toContain('assignee');
    expect(fieldsFor('add')).toContain('title');
    // One list, filtered — so the two forms cannot drift into a different
    // field order, which is the thing that makes a shared screen feel like
    // two screens.
    expect([...ADD_FIELDS]).toEqual(SET_FIELDS.filter((f) => ADD_FIELDS.includes(f)));
  });

  it('builds a new issue with exactly the members add takes', () => {
    const fields = newIssueFrom({ ...EMPTY_VALUES, title: 'a new one' });
    expect(Object.keys(fields).sort()).toEqual(['component', 'title', 'type']);
    expect(fields.type).toBe(EMPTY_VALUES.type);
    expect(ISSUE_TYPES).toContain(fields.type);
  });
});

/** Only the members the handler reads; the rest of `Key` is not consulted. */
const key = (over: Partial<Key>): Key => over as Key;

describe('handleLineKey', () => {
  it('refuses the newline a multi-line entry takes', () => {
    // A title is written into the frontmatter. A newline in it is not a
    // longer title, it is a broken file.
    expect(handleLineKey('a', '', key({ return: true }))).toBeNull();
  });

  it('appends and backspaces exactly as the multi-line entry does', () => {
    expect(handleLineKey('a', 'b', key({}))).toBe('ab');
    expect(handleLineKey('ab', '', key({ backspace: true }))).toBe('a');
    expect(handleLineKey('', '', key({ backspace: true }))).toBe('');
  });

  it('takes no control characters', () => {
    expect(handleLineKey('a', 's', key({ ctrl: true }))).toBeNull();
  });
});
```

- [x] **Step 2: Run and watch them fail**

```bash
npx vitest run --root ui tests/form-model.test.ts
```

Expected: FAIL — `../src/form.js` does not exist.

- [x] **Step 3: The single-line rule, in `TextEntry.tsx`**

Give the existing handler a flag and add the wrapper. Both current call sites
keep working untouched, because the default is what they already got.

```ts
export function handleEntryKey(
  lines: string[], input: string, key: Key, multiline = true,
): string[] | null {
  if (key.return) return multiline ? [...lines, ''] : null;
  if (key.backspace || key.delete) return backspace(lines);
  if (input !== '' && !key.ctrl && !key.meta) return append(lines, input);
  return null;
}

/**
 * The same editor, for a field that is one line.
 *
 * The rule lives in the flag rather than in a second handler beside this one:
 * a form field and the comment overlay have to agree about what a control
 * character is, and two copies would be free to disagree.
 *
 * Joined rather than taking the first line. With `multiline` false the array
 * is always one element, so the join is the identity — and a caller that ever
 * flips the flag gets a visible newline instead of a silently dropped one.
 */
export function handleLineKey(value: string, input: string, key: Key): string | null {
  const edited = handleEntryKey([value], input, key, false);
  return edited === null ? null : edited.join('\n');
}
```

- [x] **Step 4: Write `ui/src/form.ts`**

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { DEFAULT_ISSUE_TYPE, ISSUE_TYPES, SETTABLE_STATUSES } from 'ditz2';
import type { EditableFields, Issue, NewIssue } from 'ditz2';
import { moveSelection } from './components/Picker.js';

/** `set` on the selected issue, or `add` of a new one. */
export type FormMode = 'set' | 'add';

export type FormField = 'title' | 'type' | 'status' | 'component' | 'assignee';

/** Every field `set` takes, in the order the spec's mock draws them. */
export const SET_FIELDS: readonly FormField[] =
  ['title', 'type', 'status', 'component', 'assignee'];

/**
 * The two `NewIssue` has no member for.
 *
 * `createIssue` always produces an open, unassigned issue and the facade
 * offers no way to say otherwise, so `add` could not carry either. They are
 * left out of the new-issue form rather than drawn and ignored: a field on the
 * screen is a field the operator will fill in.
 */
const NOT_AT_CREATION: readonly FormField[] = ['status', 'assignee'];

export const ADD_FIELDS: readonly FormField[] =
  SET_FIELDS.filter((f) => !NOT_AT_CREATION.includes(f));

export function fieldsFor(mode: FormMode): readonly FormField[] {
  return mode === 'add' ? ADD_FIELDS : SET_FIELDS;
}

/**
 * What the form is holding.
 *
 * `component` is `string | null` and `assignee` is a plain string, which is
 * not an oversight: a picker needs a value for "none" that no component name
 * can collide with, and a text field's nothing is the empty string. The two
 * are converted at the edge, in `changedFields`.
 */
export interface FormValues {
  title: string;
  type: string;
  status: string;
  component: string | null;
  assignee: string;
}

export function valuesOf(issue: Issue): FormValues {
  return {
    title: issue.title,
    type: issue.type,
    status: issue.status,
    component: issue.component,
    assignee: issue.assignee ?? '',
  };
}

/**
 * Where `n` starts.
 *
 * `status` is never read in add mode — it is not one of `ADD_FIELDS` and
 * `newIssueFrom` does not carry it — but `FormValues` is one shape, so it
 * needs a value, and the first settable status is what `createIssue` will
 * produce anyway.
 */
export const EMPTY_VALUES: FormValues = {
  title: '',
  type: DEFAULT_ISSUE_TYPE,
  status: SETTABLE_STATUSES[0]!,
  component: null,
  assignee: '',
};

/** What each picker field offers. Built once, when the form opens. */
export interface FormChoices {
  type: readonly string[];
  status: readonly string[];
  /** null is "no component", and is always first. */
  component: readonly (string | null)[];
}

export const NO_COMPONENT = '(none)';

/**
 * How the component picker spells no component.
 *
 * A configured component could in principle be called `(none)` as well. That
 * is a display collision and not a correctness one: the picker moves by index
 * and `FormValues.component` carries the real value, so the two stay distinct
 * everywhere it matters.
 */
export function componentLabel(component: string | null): string {
  return component ?? NO_COMPONENT;
}

/**
 * The vocabulary, plus the value the issue already has when the facade would
 * not accept that value back.
 *
 * A closed issue's status is the case: `set` refuses it, so it is not in
 * `SETTABLE_STATUSES`, but the form has to be able to show it. Leaving it out
 * would mark the first option instead — `open` over an issue that is closed —
 * and any other edit would then post that as a change nobody made. Selecting
 * the extra option changes nothing, so it never reaches the facade.
 */
function withCurrent(options: readonly string[], current: string | null): string[] {
  if (current === null || options.includes(current)) return [...options];
  return [...options, current];
}

/**
 * No `mode` parameter: add mode passes a null `original`, which makes both the
 * `withCurrent` fallback and the orphaned-component push no-op on their own.
 * The mode is what picks the *field list*, in `fieldsFor` — not the choices.
 */
export function choicesFor(
  original: Issue | null, configured: readonly string[],
): FormChoices {
  const component: (string | null)[] = [null, ...configured];
  // The same rule as withCurrent, over a list whose members are nullable.
  // `component rm --force` is what leaves an issue holding one nobody lists.
  if (original?.component != null && !configured.includes(original.component)) {
    component.push(original.component);
  }
  return {
    // No withCurrent: an issue whose type is outside the vocabulary does not
    // parse, so it never reaches a form.
    type: [...ISSUE_TYPES],
    status: withCurrent(SETTABLE_STATUSES, original?.status ?? null),
    component,
  };
}

/**
 * The options a field offers, or null when the field is typed.
 *
 * The one place that says which fields are pickers. The layout, the row
 * budget and the key handler all ask here.
 */
export function optionsFor(choices: FormChoices, field: FormField): readonly string[] | null {
  switch (field) {
    case 'type': return choices.type;
    case 'status': return choices.status;
    case 'component': return choices.component.map(componentLabel);
    case 'title':
    case 'assignee': return null;
  }
}

/**
 * The text a typed field holds, or null when the field is picked.
 *
 * The other half of the partition `optionsFor` makes, and the one the key
 * handler drives off: a field is picked or it is typed, never both and never
 * neither. Both are exhaustive switches over `FormField`, so a sixth field
 * fails to compile in both places at once — and a test below asserts the
 * partition itself, which is what stops the two halves agreeing that some
 * field is neither.
 */
export function textOf(values: FormValues, field: FormField): string | null {
  switch (field) {
    case 'title': return values.title;
    case 'assignee': return values.assignee;
    case 'type':
    case 'status':
    case 'component': return null;
  }
}

/** Puts edited text back in the field it came from. */
export function typeInto(values: FormValues, field: FormField, text: string): FormValues {
  switch (field) {
    case 'title': return { ...values, title: text };
    case 'assignee': return { ...values, assignee: text };
    case 'type':
    case 'status':
    case 'component': return values;
  }
}

/** Where the current value sits in its own picker, or -1 for a typed field. */
export function indexOf(values: FormValues, choices: FormChoices, field: FormField): number {
  switch (field) {
    case 'type': return choices.type.indexOf(values.type);
    case 'status': return choices.status.indexOf(values.status);
    case 'component': return choices.component.indexOf(values.component);
    case 'title':
    case 'assignee': return -1;
  }
}

/**
 * The values `delta` steps away, or the values unchanged.
 *
 * No stored index: `values` is the only place a choice lives and the index is
 * recomputed from it, so there is nothing that can disagree with what the form
 * is about to save.
 */
export function pick(
  values: FormValues, choices: FormChoices, field: FormField, delta: number,
): FormValues {
  const at = indexOf(values, choices, field);
  if (at < 0) return values;
  switch (field) {
    case 'type':
      return { ...values, type: choices.type[moveSelection(at, delta, choices.type.length)]! };
    case 'status':
      return { ...values, status: choices.status[moveSelection(at, delta, choices.status.length)]! };
    case 'component':
      return {
        ...values,
        component: choices.component[moveSelection(at, delta, choices.component.length)] ?? null,
      };
    case 'title':
    case 'assignee':
      return values;
  }
}

/**
 * Tab is a ring; a picker's arrows are not.
 *
 * `moveSelection` clamps on purpose, so the ends of a short option list feel
 * like ends. Focus is the opposite case: five fields with a dead end at each
 * one means reversing all the way back to reach the title, and the close
 * overlay's two-field Tab already wraps. Two rules, each argued where it is.
 */
export function moveFocus(
  fields: readonly FormField[], from: FormField, delta: 1 | -1,
): FormField {
  const at = fields.indexOf(from);
  if (at < 0) return fields[0]!;
  return fields[(at + delta + fields.length) % fields.length]!;
}

/**
 * Only what the operator actually changed.
 *
 * Two reasons, and the second is the one that matters. Measured against the
 * built `dz`: `set --title 'a title' --type task`, with both already those
 * values, appends `title | a title -> a title` and `type | task -> task` to
 * the log, so sending all five would write four lies on every save. And
 * `setFields` has no compare-and-swap — it re-reads the issue under the lock
 * and writes whatever it was handed — so a form left open while somebody else
 * retitles the issue would silently undo them. A diff narrows that to the
 * fields the operator meant to touch.
 */
export function changedFields(before: FormValues, after: FormValues): EditableFields {
  const out: EditableFields = {};
  if (after.title !== before.title) out.title = after.title;
  if (after.type !== before.type) out.type = after.type;
  if (after.status !== before.status) out.status = after.status;
  if (after.component !== before.component) out.component = after.component;
  if (after.assignee !== before.assignee) {
    out.assignee = after.assignee === '' ? null : after.assignee;
  }
  return out;
}

/** Nothing to save. `setFields` refuses an empty patch, and rightly. */
export function isUnchanged(fields: EditableFields): boolean {
  return Object.keys(fields).length === 0;
}

/**
 * The new issue `add` will create.
 *
 * Typed as `NewIssue` rather than passed through as a literal, so a member
 * added to the facade's interface stops this compiling instead of being
 * quietly omitted. No body: nothing in the UI can edit one until plan 2d, and
 * `add` defaults it to empty.
 */
export function newIssueFrom(values: FormValues): NewIssue {
  return { title: values.title, type: values.type, component: values.component };
}
```

- [x] **Step 5: Run and watch them pass**

```bash
npx vitest run --root ui tests/form-model.test.ts && npx tsc -p ui/tsconfig.test.json
```

- [x] **Step 6: Prove the checks can fail**

1. Make `changedFields` assign all five unconditionally. *sends only what
   changed* must fail with four extra keys, and *sends nothing at all* must
   fail too. This is the defect that would write `alpha -> alpha` into the log
   of every issue anyone opens the form on, and nothing about the screen would
   look wrong.
2. Implement `moveFocus` with `moveSelection`. *wraps focus in both
   directions* must fail on `moveFocus(SET_FIELDS, 'assignee', 1)` returning
   `'assignee'`.
3. Delete the `component.push` in `choicesFor`. *can show a component the
   config no longer lists* must fail on `indexOf` being `-1`.
4. Delete `withCurrent`'s second line, returning the vocabulary always. *can
   show a closed status* must fail on `choices.status` not containing
   `'closed'`.
5. Map an emptied assignee to `''` instead of `null`. *clears an assignee with
   null* must fail on the value.
6. Pass `true` for `multiline` inside `handleLineKey`. *refuses the newline*
   must fail: the wrapper then returns `'a\n'` rather than null. (This is the
   breakage the `join` exists to make visible — taking `edited[0]` instead
   would have returned `'a'` and the test would have passed against a broken
   flag.)
7. Add `'status'` back to `ADD_FIELDS` by emptying `NOT_AT_CREATION`. *omits
   from the new-issue form what add cannot carry* must fail.
8. Add `assignee: values.assignee` to `newIssueFrom`. **This breakage does not
   compile** — `NewIssue` has no such member — and that is the finding: the
   typed return, not the test, is what holds this. Record it as such rather
   than as a passing check.
9. Make `textOf` return `values.type` for `'type'`. *sorts every field into
   exactly one of picked and typed* must fail at `field === 'type'`, where
   both halves are then true. Check this one runs at all: it is a `for` loop
   with the field name passed to `expect`, so the failure names the field.

- [x] **Step 7: Lint and commit**

```bash
git add ui/src/form.ts ui/tests/form-model.test.ts
git commit ui -m "ditz2-ui: model the form's fields, choices and diff"
```

### Task 4: The form, rendered

The layout, and the height App refuses to open below. No keys yet: this task
renders from props and is tested from props.

**The layout**, with focus on Component:

```
edit 01a03591  interactive conflict prompt for dz edit
                                                        ← spacer
  Title      interactive conflict prompt for dz edit
  Type       feature
  Status     open
> Component
    ( ) (none)
    (*) cli
    ( ) store
  Assignee   unassigned
                                                        ← spacer
  Body       41 lines
```

Only the focused picker is expanded; the others show their value on one line.
The alternative — every picker expanded at once, as the spec's mock draws them
side by side — is unbounded in the number of components and `Picker` renders
one option per line, which is the form it was built in and which this plan
reuses unchanged.

**Files:**
- Create: `ui/src/components/FormOverlay.tsx`, `ui/tests/form-view.test.tsx`

**Interfaces:**
- Produces:
  `<FormOverlay {...subject} values={FormValues} choices={FormChoices} focus={FormField} width={number} />`
  where `subject` is the exported discriminated union
  `FormSubject = {mode: 'set'; issue: Issue} | {mode: 'add'; issue: null}`;
  and `formRows(mode: FormMode, choices: FormChoices): number`.
- **Corrected after execution.** This block, and Steps 1 and 3 below, first
  said `mode: FormMode` beside `issue: Issue | null`. Those two are not
  independent, and the flat shape let a caller pass `mode='set'` with
  `issue={null}`, which reaches the heading as a null dereference — an Ink
  render crash at runtime, in the composing caller rather than in this file.
  App is that caller, so it is exactly the "verified components, wrongly
  composed" case `CLAUDE.md` records. The union makes the miswiring a compile
  error at the composition site, and it is what shipped.
- No `rows` prop. The form is a fixed-height layout with nothing that can
  absorb slack, so a budget it could not act on would be a lie; App refuses to
  open it below `formRows` instead, exactly as `x` does with
  `CLOSE_OVERLAY_ROWS`.

- [x] **Step 1: Write the failing tests**

Create `ui/tests/form-view.test.tsx`:

```tsx
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { FormOverlay, formRows } from '../src/components/FormOverlay.js';
import type { FormSubject } from '../src/components/FormOverlay.js';
import { EMPTY_VALUES, choicesFor, fieldsFor, valuesOf } from '../src/form.js';
import type { FormField, FormMode } from '../src/form.js';
import { lines } from './helpers.js';
import { issue } from './fixtures.js';

const ID = '01a00000-0001-7000-8000-000000000001';
const ALPHA = issue({
  id: ID, title: 'alpha', type: 'bug', component: 'cli',
  body: 'one\ntwo\nthree',
});
const CONFIGURED = ['cli', 'store'];
const CHOICES = choicesFor(ALPHA, CONFIGURED);

function draw(over: {
  mode?: FormMode; issue?: ReturnType<typeof issue> | null;
  values?: ReturnType<typeof valuesOf>; focus?: FormField;
} = {}): string[] {
  const mode = over.mode ?? 'set';
  const issued = over.issue === undefined ? ALPHA : over.issue;
  // `mode` and `issue` are one discriminated choice — see the Interfaces
  // block. Building the pair here and spreading it is what keeps that
  // correlation; two separate JSX attributes lose it and do not compile.
  const subject: FormSubject = mode === 'add' || issued === null
    ? { mode: 'add', issue: null }
    : { mode: 'set', issue: issued };
  const { lastFrame } = render(
    <FormOverlay
      {...subject}
      values={over.values ?? (subject.issue === null ? EMPTY_VALUES : valuesOf(subject.issue))}
      choices={choicesFor(subject.issue, CONFIGURED)}
      focus={over.focus ?? 'title'}
      width={80}
    />,
  );
  return lines(lastFrame());
}

describe('the form, rendered', () => {
  it('names the issue it will change', () => {
    const frame = draw().join('\n');
    expect(frame).toContain('alpha');
    // The short id, as every other heading in this UI prints it.
    expect(frame).toContain('01a00000');
  });

  it('says when it is a new issue instead', () => {
    const frame = draw({ mode: 'add', issue: null }).join('\n');
    expect(frame).toContain('new issue');
    // Nothing about an issue that does not exist yet.
    expect(frame).not.toContain('01a00000');
  });

  it('draws every field it offers and no others', () => {
    const set = draw().join('\n');
    for (const label of ['Title', 'Type', 'Status', 'Component', 'Assignee']) {
      expect(set).toContain(label);
    }
    const add = draw({ mode: 'add', issue: null }).join('\n');
    expect(add).toContain('Title');
    expect(add).not.toContain('Status');
    expect(add).not.toContain('Assignee');
  });

  it('expands the focused picker and only that one', () => {
    const frame = draw({ focus: 'type' });
    const joined = frame.join('\n');
    expect(joined).toContain('(*) bug');
    expect(joined).toContain('( ) feature');
    // Status is a picker too and must still be one line showing its value.
    expect(frame.filter((l) => l.includes('(*)'))).toHaveLength(1);
    expect(frame.some((l) => l.includes('Status') && l.includes('open'))).toBe(true);
  });

  it('marks the field the next keystroke goes to', () => {
    const onTitle = draw({ focus: 'title' });
    expect(onTitle.find((l) => l.includes('Title'))?.startsWith('>')).toBe(true);
    // A typed field also shows the block cursor, because that is where the
    // characters will land — the same cursor <TextEntry> draws everywhere.
    expect(onTitle.find((l) => l.includes('Title'))).toContain('█');
    const onStatus = draw({ focus: 'status' });
    expect(onStatus.find((l) => l.includes('Status'))?.startsWith('>')).toBe(true);
    expect(onStatus.find((l) => l.includes('Title'))?.startsWith('>')).toBe(false);
  });

  it('shows an empty assignee as unassigned when it is not being typed into', () => {
    const values = { ...valuesOf(ALPHA), assignee: '' };
    expect(draw({ values }).join('\n')).toContain('unassigned');
    // …and as an empty field with a cursor when it is, so the word is not
    // something the operator has to delete before typing a name.
    const focused = draw({ values, focus: 'assignee' }).join('\n');
    expect(focused).not.toContain('unassigned');
  });

  it('reports the body without offering to edit it', () => {
    // Plan 2d opens $EDITOR. Until then the count is there so the operator
    // can see that a save will not touch it, and no key is advertised.
    const frame = draw().join('\n');
    expect(frame).toContain('Body');
    expect(frame).toContain('3 lines');
    expect(frame).not.toContain('enter');
  });

  it('can show a component the config no longer lists', () => {
    const orphan = issue({ id: ID, title: 'alpha', component: 'legacy' });
    expect(draw({ issue: orphan, focus: 'component' }).join('\n')).toContain('legacy');
  });

  it('is exactly as tall as formRows says, at its tallest, and never taller', () => {
    // Both directions on purpose. An upper bound alone would pass for a
    // floor set far too high, which would refuse the form on terminals it
    // fits in; the equality is what pins it to the layout. This is the test
    // that has to fail if either the layout or the arithmetic moves.
    for (const mode of ['set', 'add'] as FormMode[]) {
      const subject = mode === 'add' ? null : ALPHA;
      const choices = choicesFor(subject, CONFIGURED);
      const heights = fieldsFor(mode).map(
        (focus) => draw({ mode, issue: subject, focus }).length,
      );
      for (const height of heights) {
        expect(height, `${mode} at most`).toBeLessThanOrEqual(formRows(mode, choices));
      }
      expect(Math.max(...heights), `${mode} at least once`)
        .toBe(formRows(mode, choices));
    }
  });
});
```

- [x] **Step 2: Run and watch them fail**

```bash
npx vitest run --root ui tests/form-view.test.tsx
```

Expected: FAIL — `../src/components/FormOverlay.js` does not exist.

- [x] **Step 3: Write `ui/src/components/FormOverlay.tsx`**

```tsx
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, Text } from 'ink';
import React from 'react';
import { shortId } from 'ditz2';
import type { Issue } from 'ditz2';
import { UNASSIGNED, truncate } from '../format.js';
import { Picker } from './Picker.js';
import { TextEntry } from './TextEntry.js';
import { componentLabel, fieldsFor, indexOf, optionsFor, textOf } from '../form.js';
import type { FormChoices, FormField, FormMode, FormValues } from '../form.js';

/** Wide enough for `Component`, plus the gap the values line up after. */
const LABEL_WIDTH = 11;
/** The mark column and the space after it, which every row carries. */
const MARK_WIDTH = 2;
/** Heading, spacer, spacer, body — the rows that are not fields. */
const CHROME = 4;

/**
 * The most rows the form can need, which is what App refuses to open below.
 *
 * Only the focused picker is expanded, so the height depends on which field
 * has focus — and focus moves while the form is open, so the floor is the
 * tallest arrangement rather than the current one. A picker that fits when it
 * opens and overflows two Tabs later is the clipped-selection failure the
 * close overlay's floor exists to prevent.
 *
 * Exported because App is the one that has to refuse, and computed from the
 * same `choices` the layout draws from: a second count living beside the check
 * would be free to drift from the thing it describes.
 */
export function formRows(mode: FormMode, choices: FormChoices): number {
  const fields = fieldsFor(mode);
  const tallest = Math.max(
    ...fields.map((field) => optionsFor(choices, field)?.length ?? 0),
  );
  return fields.length + tallest + CHROME;
}

/** How many lines of body a save will leave alone. */
function bodyLines(issue: Issue | null): number {
  if (issue === null || issue.body === '') return 0;
  return issue.body.split('\n').length;
}

function label(field: FormField): string {
  return `${field[0]!.toUpperCase()}${field.slice(1)}`.padEnd(LABEL_WIDTH);
}

/**
 * What an unfocused field shows.
 *
 * `unassigned` is the word `format.ts` already uses on the detail line. It is
 * only shown when the field does not have focus: a placeholder inside a field
 * being typed into is something the operator has to delete first.
 */
function shown(values: FormValues, field: FormField): string {
  switch (field) {
    case 'title': return values.title;
    case 'type': return values.type;
    case 'status': return values.status;
    case 'component': return componentLabel(values.component);
    case 'assignee': return values.assignee === '' ? UNASSIGNED : values.assignee;
  }
}

/** What both modes need, whether or not there is an issue behind the form. */
interface FormCommon {
  values: FormValues;
  choices: FormChoices;
  focus: FormField;
  width: number;
}

/**
 * The mode and its subject, as one choice rather than two props.
 *
 * See the Interfaces block above for why this is a union: the flat
 * `mode: FormMode` beside `issue: Issue | null` admits `mode='set'` with a null
 * issue, which the heading below dereferences.
 */
export type FormSubject =
  | { mode: 'set'; issue: Issue }
  | { mode: 'add'; issue: null };

export function FormOverlay(
  { mode, issue, values, choices, focus, width }: FormCommon & FormSubject,
): React.ReactElement {
  // No `!`. The union narrows `issue` to an `Issue` on the `set` arm.
  const heading = mode === 'add'
    ? 'new issue'
    : `edit ${shortId(issue.id)}  ${issue.title}`;
  // The value column, for the fields that draw one.
  const room = Math.max(width - LABEL_WIDTH - MARK_WIDTH, 1);

  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate">{truncate(heading, width)}</Text>
      <Text> </Text>
      {fieldsFor(mode).map((field) => {
        const on = field === focus;
        const mark = on ? '>' : ' ';
        const options = optionsFor(choices, field);
        if (options !== null && on) {
          return (
            <Box flexDirection="column" key={field}>
              <Text wrap="truncate">{truncate(`${mark} ${label(field)}`, width)}</Text>
              <Picker options={options} selected={indexOf(values, choices, field)} width={width} />
            </Box>
          );
        }
        // `textOf` is the other half of the partition `optionsFor` makes — a
        // field is picked or it is typed — so asking it rather than casting
        // `values[field]` keeps both halves answered in the one place that
        // owns the partition. A field that were somehow neither falls through
        // to the unfocused row instead of through a cast that hid it.
        const text = textOf(values, field);
        if (text !== null && on) {
          return (
            <Box key={field}>
              <Text wrap="truncate">{`${mark} ${label(field)}`}</Text>
              {/* The block cursor lives in one place, and this is it. */}
              <TextEntry lines={[text]} rows={1} width={room} />
            </Box>
          );
        }
        return (
          <Text key={field} wrap="truncate">
            {truncate(`${mark} ${label(field)}${shown(values, field)}`, width)}
          </Text>
        );
      })}
      <Text> </Text>
      <Text dimColor wrap="truncate">
        {truncate(`  ${'Body'.padEnd(LABEL_WIDTH)}${bodyLines(issue)} lines`, width)}
      </Text>
    </Box>
  );
}
```

**This step first wrote `values[field] as string`**, on the grounds that the
branch is only reached when `optionsFor` returned null, which it does for
exactly the two fields `FormValues` types as `string` — and offered the
reviewer an explicit alternative if they preferred one. They did, and it
shipped: `textOf` is the other half of the same partition, so asking it keeps
both halves answered in the one module that owns the partition instead of
telling the type system something here. The cast was the only place in this
file where the type system was being told rather than asked, and there is now
no such place.

- [x] **Step 4: Run and watch them pass**

```bash
npx vitest run --root ui tests/form-view.test.tsx && npx tsc -p ui/tsconfig.test.json
```

- [x] **Step 5: Prove the checks can fail**

1. Add `+ 1` to `formRows`. *is exactly as tall as formRows says* must fail on
   the `at least once` equality — the upper-bound half stays green, which is
   the point of having both.
2. Subtract `1` instead. The same test must fail on the `at most` half, at the
   focus position that expands the tallest picker (`component` in set mode).
3. Expand every picker, not only the focused one: drop the `&& on` from the
   first branch. *expands the focused picker and only that one* must fail on
   `toHaveLength(1)`, and the height test must fail too — report both, because
   the second is the one that would have shown up as a scrolled frame.
4. Render the mark as `' '` always. *marks the field the next keystroke goes
   to* must fail on the first `startsWith('>')`.
5. Show `unassigned` even when focused. *shows an empty assignee as
   unassigned…* must fail on its second half.
6. Draw `Status` and `Assignee` in add mode by using `SET_FIELDS` directly.
   *draws every field it offers and no others* must fail on
   `not.toContain('Status')`.

- [x] **Step 6: Lint and commit**

```bash
git add ui/src/components/FormOverlay.tsx ui/tests/form-view.test.tsx
git commit ui -m "ditz2-ui: draw the form, and say how tall it needs to be"
```

### Task 5: `Tab` — editing an issue

The form opens over the selected issue, the keys work, and `Ctrl-S` calls
`set`. `n` is Task 6 and nothing here binds it, but the field list, the
component picker and the save path are all written mode-aware so that Task 6 is
a binding and a branch rather than a second screen.

**Files:**
- Create: `ui/tests/form.test.tsx`
- Modify: `ui/src/state.ts`, `ui/src/app.tsx`,
  `ui/src/components/HelpOverlay.tsx`, `ui/tests/state.test.ts`,
  `ui/tests/helpers.tsx`, `ui/tests/app-keys.test.tsx`,
  `ui/tests/app-filter.test.tsx`

**Interfaces:**
- `UiState.overlay` gains `{kind: 'form'}`; `UiAction` gains
  `{type: 'openForm'; mode: FormMode}` and `{type: 'select'; id: string}`.
- `app.tsx` exports `FORM_TOO_SHORT` and `NO_CHANGES`, the two things `Ctrl-S`
  and `Tab` can say instead of acting, so tests assert the constant rather than
  a copy of its text.
- **Adding the overlay kind will not compile** until `overlays` in `app.tsx`
  has a `form` row, because `OverlayKind` is derived from `UiState`. Let that
  error happen and read it; it is the guarantee the table was built for.

**Footer arithmetic**, measured, at the 80-column fixture:

| | |
| --- | --- |
| `FORM_KEYS[0] = 'tab/shift-tab field  up/down pick  ^S save  esc cancel'` | 54 |
| `LIST_KEYS[1] = 'tab edit  n new  c comment  x close'` | 35 |
| the same, projected once 2d adds `  e body` | 43 |

Task 2 built the second footer line and left it holding `c comment  x close`;
this task is what puts `tab edit  n new` in front of them. `LIST_KEYS[0]` is
untouched at 48, `ERROR_KEYS[0]` stays at 61, and the widest footer line in the
project after this plan is still `ISSUE_KEYS[0]` at 62 of 80, with the widest
composed one still that 61. Nothing here spends the margin
Task 2 bought — the line this grows is the 35-column one, and the projection
test written in Task 2 is what keeps it honest.

- [x] **Step 1: The reducer tests**

Append to `ui/tests/state.test.ts`:

```ts
describe('the form overlay', () => {
  it('opens over the selected issue', () => {
    expect(run(start(), { type: 'openForm', mode: 'set' }).overlay)
      .toEqual({ kind: 'form' });
  });

  it('does nothing on an empty list, because there is nothing to change', () => {
    expect(run(initialState([], []), { type: 'openForm', mode: 'set' }).overlay).toBeNull();
  });

  it('opens with nothing selected when the form is a new issue', () => {
    // The one form that needs no selection. `n` on an empty backlog is
    // exactly when somebody most wants it.
    expect(run(initialState([], []), { type: 'openForm', mode: 'add' }).overlay)
      .toEqual({ kind: 'form' });
  });

  it('clears a stale status line when any overlay opens', () => {
    // `the close form needs a taller terminal` used to survive the terminal
    // that caused it, because nothing cleared it and <Notice> draws under
    // every overlay that is not an error. Recorded in HANDOFF.md as reachable
    // with no error at all; this is the fix, in the one place all three
    // openings share.
    for (const action of [
      { type: 'openComment' }, { type: 'openClose' }, { type: 'openForm', mode: 'set' },
    ] as const) {
      const s = run(start(), { type: 'notice', text: 'something older' }, action);
      expect(s.notice, action.type).toBeNull();
    }
  });

  it('moves the cursor to an id it is given', () => {
    const s = run(start(), { type: 'select', id: three()[2]!.id });
    expect(selectedIssue(s)?.title).toBe('gamma');
  });
});
```

- [x] **Step 2: Run them and watch them fail**

```bash
npx vitest run --root ui tests/state.test.ts
```

Expected: FAIL — neither action exists.

- [x] **Step 3: The reducer**

In `ui/src/state.ts`, widen the overlay union with `| { kind: 'form' }`, add
the two actions —

```ts
  | { type: 'openForm'; mode: 'set' | 'add' }
  | { type: 'select'; id: string }
```

— and fold `openForm` into the case that already opens the other two:

```ts
/** The overlay each opening action asks for. */
const OPENS: Record<'openComment' | 'openClose' | 'openForm', 'comment' | 'close' | 'form'> = {
  openComment: 'comment', openClose: 'close', openForm: 'form',
};
```

```ts
    case 'openComment':
    case 'openClose':
    case 'openForm': {
      // Nothing selected means nothing to write to — except a new issue,
      // which is the one form that needs no selection. Silently doing nothing
      // otherwise is right: an error for pressing a key on an empty list is
      // noise.
      const needsSelection = action.type !== 'openForm' || action.mode === 'set';
      if (needsSelection && selectedIssue(state) === null) return state;
      // The status line is cleared on open rather than on close: a message
      // about something that happened before this overlay would otherwise sit
      // underneath it, which is how the close form's own refusal came to
      // outlive the terminal that caused it.
      return { ...state, overlay: { kind: OPENS[action.type] }, notice: null };
    }

    case 'select':
      // Deliberately unvalidated. Its only caller dispatches it from inside a
      // write, before the reload that reconciles it: `mutationSucceeded` runs
      // `reselect` immediately after, which either keeps this id or reports
      // that it is not in the list. A second check here would be a second
      // answer to one question.
      return { ...state, selectedId: action.id };
```

Note the `mode` is used and not stored. What mode the open form is in lives in
`FormState` beside the values it decides the shape of; a copy in `UiState`
would be a second answer to that question too.

- [x] **Step 4: Write the app tests**

Create `ui/tests/form.test.tsx`. The local `mount` is not the shared one:
`helpers.tsx` renders at 14 rows, which is below the form's floor, and the
shared stub rejects `components.list`.

```tsx
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { DzError, ISSUE_TYPES } from 'ditz2';
import type { EditableFields, Issue, Project } from 'ditz2';
import { App, FORM_TOO_SHORT, NO_CHANGES } from '../src/app.js';
import { initialState } from '../src/state.js';
import { KEY, footerOf, lines, press, stubProject } from './helpers.js';
import { issue, three } from './fixtures.js';

/**
 * Twenty rows, not the fourteen `helpers.tsx` uses.
 *
 * App keeps five back before an overlay sees a budget — two chrome rows, the
 * two-line footer and <Detail>'s border — and the form needs twelve, so at
 * fourteen every test here would be measuring a refusal instead of a form.
 * The refusal has its own test, at twelve.
 */
const ROWS = 20;

function mount(over: Partial<Project> = {}, issues: Issue[] = three(), rows = ROWS) {
  const onExit = vi.fn();
  const r = render(
    <App project={stubProject(over)} initial={initialState(issues, [])}
      rows={rows} width={80} onExit={onExit} />,
  );
  return { ...r, onExit };
}

/** A `set` that records, and returns something shaped like an issue. */
function recorder() {
  const calls: [string, EditableFields][] = [];
  const set = (prefix: string, fields: EditableFields): Issue => {
    calls.push([prefix, fields]);
    return three()[0]!;
  };
  return { calls, set };
}

describe('the form', () => {
  it('opens on Tab over the selected issue', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.tab);
    expect(lines(lastFrame()).join('\n')).toContain('alpha');
    expect(footerOf(lastFrame())).toContain('up/down pick');
  });

  it('does not open on Enter, which still opens the reader', async () => {
    // The spec said Enter; the reader took it, and `?` and the footer both
    // say Tab. A regression here is the operator pressing Enter and getting
    // a form they cannot leave with Enter.
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.enter);
    const footer = footerOf(lastFrame());
    expect(footer).toContain('enter/esc back');
    expect(footer).not.toContain('up/down pick');
  });

  it('does nothing on Tab when the list is empty', async () => {
    const { lastFrame, stdin } = mount({}, []);
    await press(stdin, KEY.tab);
    expect(lastFrame()).not.toContain('up/down pick');
  });

  it('moves focus with Tab and back with Shift-Tab', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.tab);
    expect(lines(lastFrame()).find((l) => l.includes('Title'))?.startsWith('>')).toBe(true);
    await press(stdin, KEY.tab);
    expect(lines(lastFrame()).find((l) => l.includes('Type'))?.startsWith('>')).toBe(true);
    await press(stdin, KEY.shiftTab);
    expect(lines(lastFrame()).find((l) => l.includes('Title'))?.startsWith('>')).toBe(true);
  });

  it('moves a picker with the arrows, not the list behind it', async () => {
    const { lastFrame, stdin } = mount();
    // alpha is a bug, which is ISSUE_TYPES[0].
    await press(stdin, KEY.tab, KEY.tab, KEY.down);
    expect(lastFrame()).toContain(`(*) ${ISSUE_TYPES[1]}`);
    await press(stdin, KEY.escape);
    expect(lines(lastFrame()).find((l) => l.startsWith('>'))).toContain('alpha');
  });

  it('ignores the arrows on a typed field, and does not let them reach the list', async () => {
    // Two halves, and they are held by different things. That the type does
    // not move is held by `pick` being exhaustive over the field union and
    // returning its input for a typed one — the type system, not this test.
    // That the *list* does not move is held by where the branch sits, and is
    // what this test can actually catch.
    const { calls, set } = recorder();
    const { lastFrame, stdin } = mount({ set });
    await press(stdin, KEY.tab, KEY.down, KEY.down, 'z', KEY.ctrlS);
    expect(calls[0]![1]).toEqual({ title: 'alphaz' });
    expect(lines(lastFrame()).find((l) => l.startsWith('>'))).toContain('alpha');
  });

  it('types into the title, and q is a letter there', async () => {
    const { calls, set } = recorder();
    const { onExit, stdin } = mount({ set });
    await press(stdin, KEY.tab, 'q', KEY.ctrlS);
    expect(onExit).not.toHaveBeenCalled();
    expect(calls[0]![1]).toEqual({ title: 'alphaq' });
  });

  it('sends only the fields that changed', async () => {
    const { calls, set } = recorder();
    const { stdin } = mount({ set });
    await press(stdin, KEY.tab, '!', KEY.ctrlS);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe(three()[0]!.id);
    // Not `toMatchObject`: the point is the absence of the other four.
    // `set` writes a log entry for every field it is given, changed or not.
    expect(Object.keys(calls[0]![1])).toEqual(['title']);
  });

  it('does not write at all when nothing changed', async () => {
    const { calls, set } = recorder();
    const { lastFrame, stdin } = mount({ set });
    await press(stdin, KEY.tab, KEY.ctrlS);
    expect(calls).toHaveLength(0);
    expect(lastFrame()).toContain(NO_CHANGES);
    expect(lastFrame()).not.toContain('up/down pick');
  });

  it('clears the last thing it said when it reopens', async () => {
    // The family of the never-cleared refusal recorded in HANDOFF.md: a
    // status line describing the previous keystroke must not sit under the
    // form this one opened.
    const { calls, set } = recorder();
    const { lastFrame, stdin } = mount({ set });
    await press(stdin, KEY.tab, KEY.ctrlS);
    expect(lastFrame()).toContain(NO_CHANGES);
    await press(stdin, KEY.tab);
    expect(lastFrame()).not.toContain(NO_CHANGES);
    expect(calls).toHaveLength(0);
  });

  it('offers the components the project reports, and no component first', async () => {
    // A different list from the fixture's own on purpose: `docs` and `ui`
    // appear nowhere else, so a picker built from a literal cannot pass this.
    // gamma has no component, so nothing is added to the vocabulary for it.
    const { lastFrame, stdin } = mount({
      components: { list: () => ['docs', 'ui'], add: () => { throw new Error('no'); },
        remove: () => { throw new Error('no'); } },
    });
    await press(stdin, 'G', KEY.tab, KEY.tab, KEY.tab, KEY.tab);
    const frame = lines(lastFrame()).join('\n');
    expect(frame).toContain('(*) (none)');
    expect(frame).toContain('( ) docs');
    expect(frame).toContain('( ) ui');
    expect(frame).not.toContain('( ) cli');
  });

  it('sends a chosen component, and null for none', async () => {
    const { calls, set } = recorder();
    const { stdin } = mount({ set });
    // alpha's component is cli, the second option after (none).
    await press(stdin, KEY.tab, KEY.tab, KEY.tab, KEY.tab, KEY.up, KEY.ctrlS);
    expect(calls[0]![1]).toEqual({ component: null });
  });

  it('sends null, not an empty string, for an emptied assignee', async () => {
    const { calls, set } = recorder();
    const assigned = [issue({
      id: '01a00000-0009-7000-8000-000000000009', title: 'assigned', assignee: 'jane',
    })];
    const { stdin } = mount({ set }, assigned);
    await press(stdin, KEY.tab, KEY.tab, KEY.tab, KEY.tab, KEY.tab,
      KEY.backspace, KEY.backspace, KEY.backspace, KEY.backspace);
    await press(stdin, KEY.ctrlS);
    expect(calls[0]![1]).toEqual({ assignee: null });
  });

  it('abandons on Esc without writing', async () => {
    const { calls, set } = recorder();
    const { lastFrame, stdin } = mount({ set });
    await press(stdin, KEY.tab, 'z', KEY.escape);
    expect(calls).toHaveLength(0);
    expect(lastFrame()).not.toContain('up/down pick');
    // Discarded, not hidden: reopening shows the issue, not the edit.
    await press(stdin, KEY.tab);
    expect(lines(lastFrame()).find((l) => l.includes('Title'))).not.toContain('alphaz');
  });

  it('keeps the edits when the facade refuses, and says why', async () => {
    // The same rule as the comment draft: the worst moment to throw away
    // what somebody typed is the moment they are told it did not save.
    const { lastFrame, stdin } = mount({
      set: () => { throw new DzError('INVALID_FIELD', 'no author identity: set DZ_AUTHOR'); },
    });
    await press(stdin, KEY.tab, 'z', KEY.ctrlS);
    expect(lastFrame()).toContain('no author identity');
    await press(stdin, KEY.tab);
    expect(lines(lastFrame()).find((l) => l.includes('Title'))).toContain('alphaz');
  });

  it('starts over on a different issue', async () => {
    // The error overlay leaves the list interactive, so the selection can
    // move before the form is reopened — and the edit must not follow it.
    const { lastFrame, stdin } = mount({
      set: () => { throw new DzError('INVALID_FIELD', 'no author identity'); },
    });
    await press(stdin, KEY.tab, 'z', KEY.ctrlS, 'j', KEY.tab);
    const title = lines(lastFrame()).find((l) => l.includes('Title')) ?? '';
    expect(title).toContain('beta');
    expect(title).not.toContain('alphaz');
  });

  it('closes and reloads on success', async () => {
    let listCalls = 0;
    const { stdin, lastFrame } = mount({
      set: () => three()[0]!,
      list: () => { listCalls += 1; return { issues: three(), failures: [] }; },
    });
    await press(stdin, KEY.tab, 'z', KEY.ctrlS);
    expect(listCalls).toBe(1);
    expect(lastFrame()).not.toContain('up/down pick');
  });

  it('refuses to open in a terminal it would overflow', async () => {
    const { lastFrame, stdin } = mount({}, three(), 12);
    await press(stdin, KEY.tab);
    expect(lastFrame()).toContain(FORM_TOO_SHORT);
    expect(lastFrame()).not.toContain('up/down pick');
  });

  it('advertises the keys the form answers, and only those', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.tab);
    const footer = footerOf(lastFrame());
    for (const key of ['tab/shift-tab field', 'up/down pick', '^S save', 'esc cancel']) {
      expect(footer).toContain(key);
    }
    expect(footer).not.toContain('q quit');
    expect(footer).not.toContain('/ filter');
  });
});
```

`KEY.shiftTab` does not exist yet. Add it to `ui/tests/helpers.tsx`:

```ts
  tab: '\t',
  /** CSI Z. Ink parses it as name `tab` with `shift` set; see parse-keypress.js. */
  shiftTab: '\u001B[Z',
```

and give both stubs a working `components.list`, in `helpers.tsx` and in the
near-copy inside `app-keys.test.tsx`:

```ts
    // The fixture's own two components, so that no issue in `three()` holds
    // one the config does not list and the form's height is predictable.
    // A default that answers is safe here because nothing else calls it —
    // but note that plan 2b's filter test passed for free against a default
    // `list` that ignored its argument, so any test about *which* components
    // are offered must pass its own.
    components: { list: () => ['cli', 'store'], add: reject, remove: reject },
```

- [x] **Step 5: Run and watch them fail**

```bash
npx vitest run --root ui tests/form.test.tsx
```

Expected: FAIL — `Tab` does nothing.

- [x] **Step 6: Wire it into `app.tsx`**

The imports, added to what is already there — `Issue` joins the existing type
import from `'ditz2'`, and `handleLineKey` joins `handleEntryKey`:

```tsx
import { FormOverlay, formRows } from './components/FormOverlay.js';
import { handleEntryKey, handleLineKey } from './components/TextEntry.js';
import {
  EMPTY_VALUES, changedFields, choicesFor, fieldsFor, isUnchanged, moveFocus,
  newIssueFrom, pick, textOf, typeInto, valuesOf,
} from './form.js';
import type { FormChoices, FormField, FormMode, FormValues } from './form.js';
```

The state, beside `draft` and for the same reason:

```tsx
/**
 * The open form: what it is editing, what it started from, and where the
 * cursor is.
 *
 * One object rather than the four separate pieces the close overlay keeps.
 * That is not tidiness. `HANDOFF.md` records a close overlay whose draft was
 * cleared on a successful write and whose resolution was not, so the next `x`
 * came up showing the resolution of the last one. Values, focus, choices and
 * the issue they belong to cannot come apart if they are cleared in a single
 * assignment.
 */
interface FormState {
  mode: FormMode;
  /** What `changedFields` diffs against. Null in add mode. */
  original: Issue | null;
  values: FormValues;
  focus: FormField;
  /** Captured at open: `components.list()` reads the config and can throw. */
  choices: FormChoices;
}
```

```tsx
  const [form, setForm] = React.useState<FormState | null>(null);
```

The two things a key can say instead of acting, exported for the tests:

```tsx
/** What `Tab` says instead of opening a form that would not fit. */
export const FORM_TOO_SHORT = 'the form needs a taller terminal';
/** What `^S` says instead of taking the lock to write nothing. */
export const NO_CHANGES = 'no changes';
```

Opening, which is `startDraft`'s counterpart:

```tsx
  /**
   * Opens the form, unless it cannot be drawn.
   *
   * Reopening the same form on the same issue keeps what was typed, which is
   * the state a refused write leaves the operator in — the same rule, and the
   * same reason, as the comment draft. Anything else starts from the issue.
   * A kept form also keeps the choices it opened with, which is the same
   * staleness as the values it is keeping.
   */
  const startForm = React.useCallback((mode: FormMode) => {
    const original = mode === 'add' ? null : selected;
    if (mode === 'set' && original === null) return;
    let components: string[];
    try {
      components = project.components.list();
    } catch (err) {
      // Reading the config is not a mutation: there is no lock to wait for
      // and nothing to retry, so this is a notice rather than anything
      // runMutation would recognise.
      dispatch({ type: 'notice', text: `cannot read the components: ${(err as Error).message}` });
      return;
    }
    const choices = choicesFor(original, components);
    if (listRows + detailRows < formRows(mode, choices)) {
      // The same budget `x` compares against, deliberately: HANDOFF.md
      // records that it is one row conservative, and a second, looser one
      // computed here would be a second rule to keep true.
      dispatch({ type: 'closeOverlay' });
      dispatch({ type: 'notice', text: FORM_TOO_SHORT });
      return;
    }
    const same = form !== null && form.mode === mode
      && (form.original?.id ?? null) === (original?.id ?? null);
    if (!same) {
      setForm({
        mode,
        original,
        values: original === null ? EMPTY_VALUES : valuesOf(original),
        focus: fieldsFor(mode)[0]!,
        choices,
      });
    }
    dispatch({ type: 'openForm', mode });
  }, [project, selected, form, listRows, detailRows]);
```

Saving:

```tsx
  /** What `^S` does, in either mode. */
  const saveForm = React.useCallback((open: FormState) => {
    if (open.mode === 'add') {
      const fields = newIssueFrom(open.values);
      write('add', () => {
        const created = project.add(fields);
        // Inside the thunk, exactly as the comment draft is cleared inside
        // its own: `r` on the waiting overlay runs this again, and a retry
        // that finally lands must leave what a first attempt would have.
        dispatch({ type: 'select', id: created.id });
        setForm(null);
      });
      return;
    }
    const original = open.original!;
    const changed = changedFields(valuesOf(original), open.values);
    if (isUnchanged(changed)) {
      // Not a write. `setFields` refuses an empty patch and is right to, but
      // taking the project lock in order to be told what the form already
      // knows would make an idle ^S contend with an agent.
      setForm(null);
      dispatch({ type: 'closeOverlay' });
      dispatch({ type: 'notice', text: NO_CHANGES });
      return;
    }
    write('set', () => {
      project.set(original.id, changed);
      setForm(null);
    });
  }, [project, write]);
```

The keyboard branch. It goes **with the other overlay branches, above the
shared arrow-navigation block** — its arrows move a picker and would otherwise
move the list behind it. Among the overlay branches its position does not
matter: overlay kinds are mutually exclusive, which is the property the render
table is built on.

```tsx
    if (state.overlay?.kind === 'form' && form !== null) {
      if (key.escape) { setForm(null); dispatch({ type: 'closeOverlay' }); return; }
      if (key.tab) {
        setForm({
          ...form,
          focus: moveFocus(fieldsFor(form.mode), form.focus, key.shift ? -1 : 1),
        });
        return;
      }
      if (key.ctrl && input === 's') { saveForm(form); return; }
      const text = textOf(form.values, form.focus);
      if (text === null) {
        // A picker has focus. Inside this check and not above it: arrows that
        // keep moving a picker while a typed field has focus are the bug the
        // close overlay's own focus check exists to prevent.
        if (key.downArrow) { setForm({ ...form, values: pick(form.values, form.choices, form.focus, 1) }); return; }
        if (key.upArrow) { setForm({ ...form, values: pick(form.values, form.choices, form.focus, -1) }); return; }
        return;
      }
      const edited = handleLineKey(text, input, key);
      if (edited !== null) {
        setForm({ ...form, values: typeInto(form.values, form.focus, edited) });
      }
      return;
    }
```

The binding, with the other list-screen keys and before `key.return` so the
reader keeps `Enter`:

```tsx
    if (key.tab && !key.shift) { startForm('set'); return; }
```

Shift-Tab does nothing on the list. That is deliberate rather than an
oversight: it is the form's *back* and a stray one arriving after `Esc` should
not reopen what it just closed.

The table row:

```tsx
    // Only reachable with a form: startForm sets one before dispatching
    // openForm, and Esc and a successful save clear both. The null arm cannot
    // be produced today and is here for the reason the waiting row's is —
    // the two live in different stores and this is the only place that reads
    // them together.
    form: {
      body: form === null ? null : () => (
        <FormOverlay mode={form.mode} issue={form.original} values={form.values}
          choices={form.choices} focus={form.focus} width={width} />
      ),
      footer: () => <Footer keys={FORM_KEYS} width={width} />,
    },
```

and the footer strings — `LIST_KEYS`'s second line grows two entries and
`FORM_KEYS` is new:

```tsx
export const LIST_KEYS: readonly string[] = [
  'up/down move  / filter  r reload  ? help  q quit',
  'tab edit  n new  c comment  x close',
];
const FORM_KEYS = ['tab/shift-tab field  up/down pick  ^S save  esc cancel'];
```

- [x] **Step 7: Help, and the two tests that measure it**

Add to `HELP` in `HelpOverlay.tsx`, after the `x` row and after the waiting
row respectively:

```ts
  ['tab', 'edit the selected issue in a form'],
  ['n', 'a new issue, in the same form'],
```

```ts
  ['in the form', 'tab/shift-tab moves between the fields'],
  ['', 'up/down picks, ^S saves, esc cancels'],
```

Each description stays inside the 48 columns the 72-wide box leaves after the
22-column key column. (An existing row, *bare words are a regex over titles,
bodies and log*, is 50 and is already clipped by two characters — noted, not
fixed here, because widening the box is a change to every help frame.)

`HELP_LINES` goes 20 → 24, so `maxHelpOffset` at the 12-row terminal
`app-filter.test.tsx` uses goes 13 → **17**, and its two scrolling tests need
recalibrating: *reaches the bindings it had no room for* from 13 downs to 17,
and *scrolls with Ctrl-D and Ctrl-U* from two pages to three, because a page
there is 8 rows and 16 no longer reaches 17. **Derive both rather than trusting
this paragraph** — `maxHelpOffset(listRows + detailRows)` at `rows = 12` is the
number — and recalibrate the fixture, never the assertion text. Plan 2a's rule
permits exactly that and forbids the reverse.

- [x] **Step 8: The two sweeps in `app-keys.test.tsx`**

Add `FORM_TOO_SHORT` to that file's import from `../src/app.js`, beside
`CLOSE_TOO_SHORT`, and add the form to the frame-height `SCREENS` table:

```tsx
    {
      name: 'the form',
      over: {},
      keys: [KEY.tab],
      marker: 'up/down pick',
      // Counted in App's `rows` prop and not in terminal rows: App keeps five
      // back on the list screen — two chrome rows, the two-line footer and
      // <Detail>'s border — and the form needs twelve, for five fields plus
      // its tallest picker plus four rows of its own chrome. Observed, like
      // the close overlay's thirteen, and it fails loudly rather than going
      // stale: if the form or the chrome grows, rows=17 refuses and this
      // marker assertion is what says so.
      minRows: 17,
      refusal: FORM_TOO_SHORT,
    },
```

and `17` to `HEIGHTS`, which — with the `13` Task 2 added for the close
overlay's shifted boundary — becomes `[8, 9, 10, 11, 12, 13, 17, 20, 23]`.
Each of `13` and `17` is a refusal boundary, swept from both sides.

Add it to the `footer width` table too:

```tsx
    ['the form', {}, [KEY.tab], 'up/down pick'],
```

**and raise that file's `ROWS` from 14 to 20**, or the row above measures
nothing. This is the same trap one overlay later: plan 2b raised it from 10 to
14 because at ten the footer sweep was measuring the list footer under a close
overlay that had never opened, and at fourteen it would measure the list footer
under a *form* that had never opened. Replace the comment on the constant with
what makes 20 the right number now, and check the file's other users of
`mount()`: the navigation tests care only about which row is marked, the paging
test renders at its own `rows={22}` and was recalibrated in Task 2, and *warns
about unreadable files* renders at its own `rows={10}`.

And in *advertises the bindings that work, and only those*. **Task 2 left two
negative assertions here that this task must flip** — it asserted
`not.toContain('tab edit')` and `not.toContain('n new')` because neither key
did anything yet, and this is the commit that makes them work. Delete those
two lines and put these in their place; leaving them would fail, which is the
point of having written them that way:

```tsx
    // Plan 2c binds both, so the footer owes both, and the footer is two
    // lines: `footerOf` joins them, so it does not matter which line either
    // lands on — only that neither is missing.
    expect(footer).toContain('tab edit');
    expect(footer).toContain('n new');
    // Enter is still the reader, in both directions. This is the forward
    // guard plan 2b left here; it stays because Enter must never become edit.
    expect(footer).not.toContain('enter edit');
```

- [x] **Step 9: Run everything and watch it pass**

```bash
npx vitest run --root ui && npx tsc -p ui/tsconfig.test.json
```

- [x] **Step 10: Prove the checks can fail**

1. Move the form's keyboard branch **below** the shared arrow block. Two tests
   must fail, on different assertions, and it is worth watching both:
   *moves a picker with the arrows, not the list behind it* fails because
   `KEY.down` dispatches `move` and the picker stays on `bug`; and *ignores
   the arrows on a typed field* fails on its **second** assertion — the write
   still carries `{title: 'alphaz'}`, because the form kept the values it
   opened with, but the cursor underneath has walked to `gamma`. Traced rather
   than assumed: the arrow block returns unconditionally, so nothing below it
   sees the key, and `Tab` and `^S` still reach the moved branch.
2. Handle the arrows above the `text === null` check. **Predicted not to
   fire**, and worth confirming: `pick` switches exhaustively over the field
   union and returns its input for `title` and `assignee`, so moving the call
   earlier changes nothing. What holds that invariant is the switch, and the
   mutation that shows it — deleting the `case 'title': case 'assignee'` arm —
   does not compile. Record it as a type-level guarantee, not a tested one.
3. Send `valuesOf` in full instead of `changedFields`. *sends only the fields
   that changed* must fail on `Object.keys`, and *does not write at all when
   nothing changed* must fail on `calls`.
4. Clear the form on failure — `setForm(null)` before `write`. *keeps the
   edits when the facade refuses* must fail on the reopened title.
5. Drop the `(form.original?.id ?? null) === (original?.id ?? null)` half of
   `same`. *starts over on a different issue* must fail: the form would reopen
   on `beta` still holding `alphaz`.
6. Bind `key.return` to `startForm('set')` as well. *does not open on Enter*
   must fail on the footer.
7. Remove `notice: null` from the opening case. *clears the last thing it said
   when it reopens* must fail.
8. Put both of this task's new entries on `LIST_KEYS[0]` instead of the second
   line, making it `'up/down move  tab edit  n new  / filter  r reload  ? help  q quit'`
   — 65, which fits — and watch **nothing** fail. Then observe that
   `ERROR_KEYS[0]` is then 78 of 80, two columns from the ceiling Task 2 exists
   to move away from, and that no test says so. That is the finding: the
   projection test guards the *second* line, which is where 2d's key goes, and
   nothing guards the first line's remaining margin. Record it rather than
   fixing it here — the fix is a second projection, and whether that is worth
   having is a question for the reviewer, not for this step.
9. Drop `  n new` from `LIST_KEYS[1]` while leaving the binding in place.
   *advertises the bindings that work, and only those* must fail — a working
   key the footer omits is the half of the rule that is easiest to break by
   accident, and `n` is the newest binding in the UI.

- [x] **Step 11: Lint and commit**

```bash
git add ui/tests/form.test.tsx
git commit ui -m "ditz2-ui: edit an issue's fields with tab"
```

### Task 6: `n` — a new issue

One binding and one branch. Everything else — the field list, the choices, the
save path — was written mode-aware in Tasks 3 to 5, so if this task needs a
second component or a second keyboard branch, that is a finding about them.

**Files:**
- Modify: `ui/src/app.tsx`, `ui/tests/form.test.tsx`

**Interfaces:** none new. `saveForm`'s `add` arm and `fieldsFor('add')` already
exist and are already tested in isolation; this task is what reaches them.

- [x] **Step 1: Write the failing tests**

Append to `ui/tests/form.test.tsx`, and add `DEFAULT_ISSUE_TYPE` and `shortId`
to its `ditz2` import and `NewIssue` to its type import:

```tsx
const CREATED = issue({ id: '01a00000-0004-7000-8000-000000000004', title: 'shiny' });

/** An `add` that records, and a `list` that then reports what it made. */
function creator() {
  const calls: NewIssue[] = [];
  return {
    calls,
    add: (fields: NewIssue): Issue => { calls.push(fields); return CREATED; },
    list: () => ({ issues: [...three(), CREATED], failures: [] }),
  };
}

describe('a new issue', () => {
  it('opens an empty form on n', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, 'n');
    const frame = lines(lastFrame()).join('\n');
    expect(frame).toContain('new issue');
    // The three fields `add` can carry, and not the two it cannot.
    expect(frame).toContain('Title');
    expect(frame).toContain('Component');
    expect(frame).not.toContain('Status');
    expect(frame).not.toContain('Assignee');
  });

  it('opens on an empty backlog, which is when it is most wanted', async () => {
    const { lastFrame, stdin } = mount({}, []);
    await press(stdin, 'n');
    expect(lastFrame()).toContain('new issue');
  });

  it('starts on the type dz add would have chosen', async () => {
    // One default, imported. Two front-ends quietly disagreeing about what an
    // unspecified type means is the drift this constant exists to stop.
    const { lastFrame, stdin } = mount();
    await press(stdin, 'n', KEY.tab);
    expect(lastFrame()).toContain(`(*) ${DEFAULT_ISSUE_TYPE}`);
  });

  it('creates exactly what was typed', async () => {
    const c = creator();
    const { stdin } = mount({ add: c.add, list: c.list });
    await press(stdin, 'n', 's', 'h', 'i', 'n', 'y', KEY.ctrlS);
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0]).toEqual({
      title: 'shiny', type: DEFAULT_ISSUE_TYPE, component: null,
    });
  });

  it('puts the cursor on the issue it just created', async () => {
    const c = creator();
    const { lastFrame, stdin } = mount({ add: c.add, list: c.list });
    await press(stdin, 'n', 's', 'h', 'i', 'n', 'y', KEY.ctrlS);
    expect(lines(lastFrame()).find((l) => l.startsWith('>'))).toContain('shiny');
  });

  it('says so when the active filter hides what was just created', async () => {
    // Creating something you then cannot see is the one confusing outcome
    // here, and the existing reselect already reports a selection it lost.
    const c = creator();
    const { lastFrame, stdin } = mount({ add: c.add, list: c.list });
    await press(stdin, '/', 'a', 'l', 'p', 'h', 'a', KEY.enter);
    await press(stdin, 'n', 's', 'h', 'i', 'n', 'y', KEY.ctrlS);
    // The id rather than the sentence: what is pinned is that the operator is
    // told which issue, not the wording, which ruling 2 leaves revisitable.
    expect(noticeOf(lastFrame())).toContain(shortId(CREATED.id));
  });

  it('does not carry a new issue into an edit of an existing one', async () => {
    // The mode half of the same rule `draftFor`'s kind enforces for the
    // comment draft: a refused write keeps its text on purpose, and the very
    // next Tab must not write that text over the selected issue's title.
    const { lastFrame, stdin } = mount({
      add: () => { throw new DzError('INVALID_FIELD', 'no author identity'); },
    });
    await press(stdin, 'n', 'd', 'r', 'a', 'f', 't', KEY.ctrlS);
    expect(lastFrame()).toContain('no author identity');
    await press(stdin, KEY.tab);
    const title = lines(lastFrame()).find((l) => l.includes('Title')) ?? '';
    expect(title).toContain('alpha');
    expect(title).not.toContain('draft');
  });
});
```

- [x] **Step 2: Run and watch them fail**

Expected: FAIL — `n` does nothing.

- [x] **Step 3: Bind it**

In `app.tsx`, with the other list-screen letters:

```tsx
    if (input === 'n') { startForm('add'); return; }
```

That is the whole of the change. If anything else needs touching, stop and
report it: the field list, the choices, the layout and the save path were all
written mode-aware two tasks ago, and needing to widen one of them here means
one of them assumed a selected issue that add mode does not have.

- [x] **Step 4: Run and watch them pass**

```bash
npx vitest run --root ui && npx tsc -p ui/tsconfig.test.json
```

- [x] **Step 5: Prove the checks can fail**

1. Make `needsSelection` unconditional in the reducer's opening case. *opens on
   an empty backlog* must fail.
2. Delete `dispatch({ type: 'select', id: created.id })` from `saveForm`'s add
   arm. *puts the cursor on the issue it just created* must fail — the cursor
   stays on `alpha` — and *says so when the active filter hides it* must fail
   too, since nothing was lost to report.
3. Make `fieldsFor` return `SET_FIELDS` for both modes. *opens an empty form on
   n* must fail on `not.toContain('Status')`.
4. Drop the `form.mode === mode` half of `same` in `startForm`. *does not carry
   a new issue into an edit* must fail: the form reopens in set mode over
   `alpha` still holding `draft`.
5. Replace `DEFAULT_ISSUE_TYPE` with `ISSUE_TYPES[0]` in `EMPTY_VALUES`.
   *starts on the type dz add would have chosen* must fail, because the two are
   `task` and `bug` and differ. **If they ever stop differing this breakage
   stops firing**, and the test stops meaning anything; say so if the vocabulary
   has been reordered by then.

An empty title is deliberately not tested here. The UI holds no copy of that
rule — `createIssue` raises it — and a stub throwing a message the test wrote
itself would prove only that the error overlay works, which Task 5 already
covers. Task 7 tests it against the real facade.

- [x] **Step 6: Lint and commit**

```bash
git commit ui -m "ditz2-ui: create an issue with n"
```

### Task 7: On disk, in a pty

Everything so far renders to a string against a stub. This task drives the
built `dzui` through a real terminal against a real project, and then asks
`dz` what is on disk. It also closes the gap `HANDOFF.md` records as a plan-2c
candidate: **no `ui/` test has ever written to the filesystem this repository
lives on**, which is exactly the environment difference that once hid a total
failure behind 291 passing tests.

**Files:**
- Modify: `ui/tests/e2e.test.ts`, `ui/README.md`, `HANDOFF.md`

**Interfaces:** none. This task adds no product code — if it needs any, that is
a finding about the previous six.

**Two things about the harness these tests run in, neither of them solid.**
Read both before deciding what a red run here means.

- **The pty runner drops keys under load.** `HANDOFF.md` records a
  pre-existing flake: with the machine busy, keystrokes sent before Ink turns
  raw mode on are lost, and 7 of 15 pty tests failed in one such run. Every
  test in this task types, and the longer sequences — `n`, five letters,
  `^S` — are the most exposed. So a failure here is not automatically a
  defect in the form: **re-run on an idle machine before concluding
  anything**, and if a test is intermittent, say so rather than loosening its
  assertion. The fix, if one is needed, is in the runner's settle gap and not
  in this plan.
- **The lock-timing test was rescoped in `5bebd1c07a1e`** and no longer
  measures a whole run against a two-second bound. It times Ctrl-S to the
  first byte of `waiting for the lock` — 11–15 ms at `lockTimeoutMs: 0`
  against 2133 ms at `2000` — and its discrimination is now structural
  (`acquireLock` throws only once `Date.now() >= deadline`) rather than a
  margin. **Do not copy the old whole-run pattern into anything added here.**
  None of the tests below measures time at all, and none should: what they
  assert is on disk.

- [x] **Step 1: The end-to-end tests**

Append to `ui/tests/e2e.test.ts`. `TAB` is built the same way `CTRL_S` is, and
for the same reason.

```ts
/** Opens the form. Built with fromCharCode, like CTRL_S: see its comment. */
const TAB = String.fromCharCode(0x09);

/** `dz show --json`, for the assertions that are about the log. */
function dzShowJson(dir: string, id: string): { title: string; log: { verb: string }[] } {
  return JSON.parse(dz(dir, ['show', id, '--json']));
}

  it('renames an issue, and dz show reads the new title back', async () => {
    await project(async (dir) => {
      const id = firstIssueId(dir);
      // Tab opens the form on the title field with the cursor at the end, so
      // typing appends. `q` after the save leaves the UI.
      await pty([process.execPath, DZUI], dir, `${TAB} again${CTRL_S}q`);
      expect(dzShowJson(dir, id).title).toContain(' again');
    });
  });

  it('writes one log entry for a one-field change, not five', async () => {
    // The payoff of sending a diff. `set` appends an entry for every field it
    // is given, changed or not — measured — so a form that sent all five
    // would leave four entries here saying `bug -> bug`. Asserting on the log
    // rather than on the title is what makes that visible: the title is
    // correct either way.
    await project(async (dir) => {
      const id = firstIssueId(dir);
      const before = dzShowJson(dir, id).log.length;
      await pty([process.execPath, DZUI], dir, `${TAB} again${CTRL_S}q`);
      const log = dzShowJson(dir, id).log;
      expect(log.length - before).toBe(1);
      expect(log.at(-1)?.verb).toBe('title');
    });
  });

  it('creates an issue that dz list can find', async () => {
    await project(async (dir) => {
      await pty([process.execPath, DZUI], dir, `nshiny${CTRL_S}q`);
      const issues = JSON.parse(dzList(dir)) as
        { title: string; type: string; component: string | null }[];
      const created = issues.find((i) => i.title === 'shiny');
      expect(created).toBeDefined();
      // The default both front-ends now read from one constant.
      expect(created?.type).toBe('task');
      expect(created?.component).toBeNull();
    });
  });

  it('says what is wrong about an empty title, and creates nothing', async () => {
    // The UI holds no copy of this rule; createIssue raises it. This is the
    // check that the operator sees the facade's own words.
    await project(async (dir) => {
      const before = (JSON.parse(dzList(dir)) as unknown[]).length;
      const r = await pty([process.execPath, DZUI], dir, `n${CTRL_S}`);
      expect(r.text).toContain('title cannot be empty');
      expect((JSON.parse(dzList(dir)) as unknown[]).length).toBe(before);
    });
  });
```

- [x] **Step 2: The same thing on the filesystem this repository lives on**

`ui/` has no analogue of `tests/cli/repo-filesystem.test.ts`, so every pty test
above runs under `os.tmpdir()`. Add one that does not. Read that file first and
mirror it: the scratch directory goes inside the checkout, `dz init` needs
`--nested` because the repository is itself a dz project, and `.dz-fstest/` is
already in `.gitignore` so a **subdirectory of it** needs no new ignore entry
and no new line in `CLAUDE.md`'s cleanup.

```ts
/**
 * The fixture, built on the checkout's own filesystem rather than in
 * os.tmpdir().
 *
 * On an ordinary clone this is the same filesystem and adds nothing. On the
 * virtual filesystem this project is also developed on it is not, and that
 * one rejected the lock's link(2) with EPERM while the whole suite passed —
 * and plan 2b's evidence that the UI writes correctly here is a paragraph
 * in HANDOFF.md describing something a person
 * did by hand, backed by no check. This is the check.
 *
 * `--nested`, because the repository is a dz project and without it every
 * command resolves upward and operates on ditz2's own tracker.
 */
const CHECKOUT_SCRATCH = path.resolve(here, '..', '..', '.dz-fstest', 'ui-form');

afterAll(() => { fs.rmSync(CHECKOUT_SCRATCH, { recursive: true, force: true }); });

async function inCheckout<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  fs.mkdirSync(CHECKOUT_SCRATCH, { recursive: true });
  const dir = fs.mkdtempSync(path.join(CHECKOUT_SCRATCH, 'run-'));
  try {
    const run = (args: string[]): string => dz(dir, args);
    run(['init', '--name', 'onrepo', '--nested']);
    run(['add', 'written on the checkout filesystem', '--type', 'task']);
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

  it('saves the form on the filesystem the repository itself lives on', async () => {
    await inCheckout(async (dir) => {
      const id = firstIssueId(dir);
      await pty([process.execPath, DZUI], dir, `${TAB} again${CTRL_S}q`);
      expect(dzShowJson(dir, id).title).toContain(' again');
    });
  });
```

`afterAll` needs adding to the vitest import in that file. Do **not** remove
`CHECKOUT_SCRATCH`'s parent: `tests/cli/repo-filesystem.test.ts` owns
`.dz-fstest` and clears it wholesale, and two files racing to delete each
other's tree is a flake waiting for the day somebody runs the suites in
parallel.

- [x] **Step 3: Prove the checks can fail**

1. Send all five fields — replace `changed` with `valuesOf(open.values)`-shaped
   full patch in `saveForm`. *writes one log entry for a one-field change* must
   fail with 5, and *renames an issue* must still pass, which is the whole
   reason the log test exists.
2. Bind the form to `Enter` instead of `Tab` in `app.tsx`. *renames an issue*
   must fail — `\t` would then do nothing and the typed text would go to the
   list, where ` again` is a space, `a`, `g`… and `q` quits. Check what the
   frame actually shows before ticking this off: the failure should be the
   title assertion, and if it is a timeout instead, say so.
3. Make `saveForm`'s add arm pass `type: 'bug'`. *creates an issue that dz list
   can find* must fail on `type`.
4. Point `CHECKOUT_SCRATCH` at `os.tmpdir()`. **Nothing fails**, and that is
   the point: on this machine the two filesystems both work, and the test
   exists for the machine and the change where they do not. Record it as a
   check that cannot fail *here* rather than pretending otherwise — the same
   standing that `tests/cli/repo-filesystem.test.ts` has on an ordinary clone.
   To see it fail on purpose, make `openProject` throw for paths under the
   scratch root and confirm this test is the one that reports it.

**As executed, four notes.** All four breakages fired as predicted; none had to
be reported as refusing to fire.

- Breakage 2 failed on the **title assertion**, not on a timeout, which is what
  this step asked to be checked before ticking: the run still exits cleanly
  because `q` is the last key either way.
- **Breakage 4's prediction held, and its fallback discriminated cleanly.**
  Retargeting `CHECKOUT_SCRATCH` at `os.tmpdir()` failed nothing. `openProject`
  throwing for `.dz-fstest` paths failed exactly one `ui/` test — this one, on
  `expect(r.code).toBe(0)`, the built `dzui` dead at exit 3 — while the other
  nineteen, all under `os.tmpdir()`, passed. Worth recording: `/tmp` here is
  `btrfs` and the checkout is `fuseblk`, so the two genuinely are different
  filesystems on this machine. They simply both work.
- **A fifth breakage** was added for the empty-title test, which Step 3 gave
  none: pre-empting an empty title inside `saveForm` with the UI's own wording
  makes *says what is wrong about an empty title* fail on
  `toContain('title cannot be empty')`. That is the assertion's whole claim —
  that the operator sees the facade's words and the UI holds no copy of the
  rule — and without a breakage it was untested.
- **The empty-title test gained a trailing `q`**, which Step 1 above does not
  show. Without it the run cannot exit and costs the harness's full
  twenty-second kill; and — the load-bearing half — `pty()` merges stderr into
  the transcript, so the message assertion is equally true of a UI that *died*
  printing the facade's error. `expect(r.code).toBe(0)` is what tells the two
  apart, exactly as the two author tests above it already document. The same
  `timedOut`/`code` pair was added to the other three new tests.

- [x] **Step 4: Documentation**

`ui/README.md`: the key table gains `tab` (edit the selected issue's fields)
and `n` (a new issue), and the *What it does not do* section loses field
editing and creation while keeping the body in `$EDITOR` and the conflict
overlay, both of which are still true.

`HANDOFF.md`, six things:

- The new test counts, and that plans 2a–2c are done with **2d the remainder**.
- **The footer is two lines now**, `CHROME_ROWS` is `2 + FOOTER_ROWS`, and the
  budget every screen gets is one row smaller. Whoever reads this next needs
  to know that before they wonder where the row went.
- **The absolute frame-height floor moved with it, from `rows = 5` to
  `rows = 6`, and nothing tests it.** Below a body budget of `B = rows −
  CHROME_ROWS − DETAIL_BORDER_ROWS` of 2, both `Math.max(…, 1)` clamps in
  `listRows`/`detailRows` fire and the two panes total `B + 1` instead of `B`.
  The frame is then `1 + (panes + 1) + notice + FOOTER_ROWS`, so it overruns
  its budget at `rows = 6` while a notice is showing — measured at 7 lines
  against a budget of 6. Pre-change, with `FOOTER_ROWS = 1`, the same
  arithmetic broke at `rows = 5`; also measured, by reverting the geometry.
  `HEIGHTS` in the frame-height sweep starts at 8, so the sweep cannot see
  either. Recorded rather than fixed: a 7-row terminal is below the close
  overlay's refusal boundary and well below anything usable, and lowering
  `HEIGHTS` would fail the sweep on a state nobody can reach. If it is ever
  worth fixing, the fix is in the clamps, not in the sweep.
- **The close overlay's refusal boundary moved from `rows = 12` to `13`**, so
  the `CloseOverlay` item's carefully-worded paragraph about which unit each
  number is counted in is now off by one. Correct it there; leave the
  reasoning, which is unchanged and is the reason the boundary tracks the
  budget rather than the overlay's own height.
- The two recorded findings this plan closed: the stale notice under a newly
  opened overlay, and `ui/` having no test on the checkout's filesystem. The
  other two — the close overlay's surviving resolution after a successful
  close, and the over-conservative boundary itself — are untouched and stay
  parked.
- **Ruling 2's message wording** (`is no longer in the list`, shown for an
  issue that never was) is accepted-for-now, not settled. It belongs in
  `HANDOFF.md`'s open questions so it is not rediscovered as a bug.

- [x] **Step 5: Full verification and commit**

```bash
npm run typecheck && npm run build && npx vitest run
rm -rf .dz-fstest
npm run test:all          # read echo $?, not the log
git commit -m "ditz2-ui: write the form to a real project, and say so in the docs"
```

---

## Acceptance

- [x] `npm run test:all` — **exit code 0**, checked with `echo $?`. The log is
      not the gate; npm 8.19.4 discards workspace-member exit statuses and this
      script only works because it calls `tsc` and `vitest` itself.
- [x] Every "prove the checks can fail" step was run, and **each breakage that
      refused to fire is reported as a finding** rather than ticked off. Plan
      2b shipped eight tests that could not fail and every one was found late.
      **Four steps in this plan predict their own non-firing** — Task 3's
      breakage 8 and Task 5's breakage 2 (both held by the type system rather
      than by a test), Task 6's breakage 5 (which stops firing if the type
      vocabulary is ever reordered) and Task 7's breakage 4 (which cannot fail
      on a machine where /tmp and the checkout share a filesystem). Those
      predictions are themselves things to confirm, not to take on trust.
- [x] **A one-field save writes exactly one log entry**, asserted on the file
      through `dz show --json`. This is the requirement most easily satisfied
      by a UI that looks completely correct.
- [x] The form's floor is exact, not merely sufficient: `formRows` equals the
      tallest rendering and exceeds none of them (Task 4's last test).
- [x] **Every line of every footer is inside 80 columns and ends without a
      `…`**, the widest being `ISSUE_KEYS[0]` at 62 and the widest composed one
      `ERROR_KEYS[0]` at 61; and **the projected
      post-2d line is pinned with room to spare**, derived from `LIST_KEYS`
      rather than copied from it. Report the measured length of every footer
      constant, as the ruling asks.
- [x] **The `?` overlay and the footer name the same keys** — `tab` and `n` in
      both, `enter edit` in neither.
- [x] `ditz2`'s runtime dependencies are still exactly `commander`, `uuid`,
      `yaml`, and `ui/` imports `ditz2` only by bare specifier.
- [x] The existing root-package tests pass **unmodified** after Task 1. If
      `dz set --status closed`'s message or `dz add`'s default had to change,
      the extraction was not faithful.
- [x] A save and a creation performed through the built `dzui` are visible in
      `dz show` and `dz list --json`, **and one of them ran on the checkout's
      own filesystem**.
- [ ] The UI was run by hand against this repository's own backlog. Plan 2b
      owed this and could not pay it; every requirement gap in plan 2a was
      found by a person looking at a screen and none by review. A form is the
      part of a TUI where that is most true — field order, what the cursor
      looks like, and whether Tab goes where the hand expects are not things a
      test has an opinion about.

      **Left unticked deliberately.** Task 7 drove the built `dzui` in a pty
      against this checkout's own `dz/` and recorded frame by frame what it
      saw — `HANDOFF.md`'s *The acceptance criterion still owed* has the
      transcript — and that run did surface one thing no test would have, the
      `?` overlay's key column overflowing on its longest entry. But an agent
      reading frames is not a person forming an opinion about whether the
      thing is any good to use, which is what this criterion is for. It goes
      to the human partner unmet for the second plan running.

## Deliberately not in this plan

**`$EDITOR` body editing and the conflict overlay are plan 2d.** The `Body` row
this plan draws is a line count and nothing more: no key opens it, and neither
the footer nor `?` says one does. `e` stays unbound.

**The spike behind 2d is already done** —
`docs/superpowers/spikes/2026-08-30-ink-editor-suspend.md`, run in a real pty
against Ink 6.8.0 because the spec measured 7.1.1, which this toolchain cannot
install. It found that suspend-without-unmount works, that post-resume state
renders, that the child gets a real tty, that the alternate screen makes no
difference even when the editor takes it too — and that `unmount()` +
`rerender()` fails *worse* than the spec says: no frame is drawn again,
`waitUntilExit()` resolves before the edit finishes, and the process will not
exit on `q`. Plan 2d should forbid that path outright rather than describe it
as a worse alternative.

**`Enter` does nothing in the form**, and the footer does not mention it. The
spec's mock says `enter pick/edit`, which assumed a picker that opens as its
own overlay; plan 2b built `Picker` as an inline list the arrows move, and this
plan reuses it unchanged. So there is nothing for `Enter` to open, and the
`edit` half of that label is the `$EDITOR` key plan 2d adds. A footer naming a
key that does nothing is the one thing this project's footer tests exist to
prevent, in both directions.

Also not here, and each for a reason:

- **A scrolling picker.** The form refuses to open when its tallest picker
  will not fit, so a project with a great many components cannot use it on a
  short terminal. That is honest and it is a real limit; the fix is a `Picker`
  that scrolls, which would change a component this plan deliberately reuses
  unchanged.
- **A baseline for `set`.** The form diffs against what it was shown, which
  narrows a concurrent overwrite to the fields the operator edited but does not
  close it. Closing it means `saveEdited`'s compare-and-swap for field writes
  too, which is a facade change and a plan of its own.
- **The `?` overlay's own bindings while an overlay is open.** Every overlay
  branch in `useInput` returns before the `?` handler, so `?` still cannot open
  from inside the form. Unchanged from plan 2b, and recorded there.
- **Two of the four findings `HANDOFF.md` parked.** This plan closes the stale
  notice under a newly opened overlay and adds the missing checkout-filesystem
  test; the close overlay's surviving resolution after a *successful* close and
  the over-conservative short-terminal boundary are left exactly as they are.
