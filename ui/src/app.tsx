/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, Text, useInput } from 'ink';
import React, { useReducer } from 'react';
import { RESOLUTIONS, shortId } from 'ditz2';
import type { Project } from 'ditz2';
import { CloseOverlay, CLOSE_OVERLAY_ROWS } from './components/CloseOverlay.js';
import type { CloseFocus } from './components/CloseOverlay.js';
import { CommentOverlay } from './components/CommentOverlay.js';
import { Detail } from './components/Detail.js';
import { Footer, FOOTER_ROWS, Header, Notice } from './components/Chrome.js';
import { FilterField } from './components/FilterField.js';
import { FormOverlay, formRows } from './components/FormOverlay.js';
import type { FormSubject } from './components/FormOverlay.js';
import { HelpOverlay, maxHelpOffset } from './components/HelpOverlay.js';
import { IssueList } from './components/IssueList.js';
import { IssueView, maxIssueOffset } from './components/IssueView.js';
import { moveSelection } from './components/Picker.js';
import { handleEntryKey, handleLineKey } from './components/TextEntry.js';
import { WaitingOverlay } from './components/WaitingOverlay.js';
import {
  EMPTY_VALUES, changedFields, choicesFor, fieldsFor, isUnchanged, moveFocus,
  newIssueFrom, pick, textOf, typeInto, valuesOf,
} from './form.js';
import type { FormChoices, FormField, FormMode, FormValues } from './form.js';
import { issueLines, truncate } from './format.js';
import { runMutation } from './mutate.js';
import { meAs } from './query.js';
import { initialState, reducer, selectedIssue, SNAPSHOT_FILTER, visibleIssues } from './state.js';
import type { UiState } from './state.js';

export interface AppProps {
  project: Project;
  /** Injected rather than loaded here, so a test can start anywhere. */
  initial: UiState;
  /**
   * The whole screen budget App may draw into, NOT the list's share of it.
   * App keeps `CHROME_ROWS` of it back and splits the remainder between the
   * list and the detail pane. See that constant for what those rows are and
   * why the count is easy to get wrong; do not restate the number here.
   * Task 10 derives this value from the terminal height.
   */
  rows: number;
  width: number;
  onExit: () => void;
}

// Two lines, because ten list-screen bindings will not fit in eighty columns
// on one. The first is what you can do without changing anything; the second
// is everything that writes. Plan 2c grew it by `tab edit` and then by
// `n new`, each with the task that bound the key; plan 2d has `e body` still
// to add — a key is advertised by the task that makes it work, never before.
// `c comment  x close` is deliberately un-zipped
// now that there is room: `c/x comment/close` existed only because one line
// had none. Every label is a word the rest of the UI already uses; `reload` is
// the word HELP uses.
export const LIST_KEYS: readonly string[] = [
  'up/down move  / filter  r reload  ? help  q quit',
  'tab edit  n new  c comment  x close',
];
const ISSUE_KEYS = ['up/down scroll  g/G top/bottom  enter/esc back  ? help  q back'];
const COMMENT_KEYS = ['type your comment  enter newline  ^S save  esc cancel'];
const CLOSE_KEYS = ['tab field  up/down resolution  ^S close  esc cancel'];
const FORM_KEYS = ['tab/shift-tab field  up/down pick  ^S save  esc cancel'];
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
//
// Exported for the same reason LIST_KEYS is: it is the **composed** footer
// line, so it is the one a margin test has to measure. Not the widest line in
// the project — measured, ISSUE_KEYS[0] is 62 columns and this is 61 — and the
// distinction is the point rather than a caveat. ISSUE_KEYS is a literal that
// only changes when somebody edits it, while this line is LIST_KEYS[0] plus a
// fixed prefix and therefore grows every time the list gains a binding, which
// is how the ceiling was reached both times. A margin test guards the line
// that moves on its own. The width sweep covers all seven footers, this one
// included, against actually being clipped.
//
// A test that rebuilt this from its own copy of the `esc dismiss  ` prefix
// would be measuring its own arithmetic rather than the string App draws.
export const ERROR_KEYS: readonly string[] = [
  `esc dismiss  ${LIST_KEYS[0]}`,
  ...LIST_KEYS.slice(1),
];

/**
 * What `x` says instead of opening a form that would not fit.
 *
 * No row count in it. App is handed a budget and does not know what the
 * terminal is — index.tsx subtracts a row before passing it — so any number
 * printed here would be a guess about a different module's arithmetic.
 */
export const CLOSE_TOO_SHORT = 'the close form needs a taller terminal';

/** What `Tab` says instead of opening a form that would not fit. */
export const FORM_TOO_SHORT = 'the form needs a taller terminal';
/** What `^S` says instead of taking the lock to write nothing. */
export const NO_CHANGES = 'no changes';

/** The two overlays that take a comment, and so share `draft`. */
type DraftKind = 'comment' | 'close';

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
 *
 * `issue` is also the baseline `changedFields` diffs against, and it is kept
 * here rather than re-read from the snapshot at save time for the reason
 * `saveEdited` was once mis-composed: values and the baseline they are
 * compared with have to come from one read, or an edit typed against one
 * version of the issue is diffed against another.
 */
type FormState = FormSubject & {
  values: FormValues;
  focus: FormField;
  /** Captured at open: `components.list()` reads the config and can throw. */
  choices: FormChoices;
};

/**
 * Every kind `UiState.overlay` can be, derived rather than re-listed.
 *
 * A hand-written copy would be free to fall behind the reducer's union, and
 * the table below would then quietly stop covering a kind it still has to.
 */
type OverlayKind = NonNullable<UiState['overlay']>['kind'];

/**
 * The two parts of the frame an open overlay may take over: the body between
 * the header and the status line, and the footer.
 *
 * A null slot is the overlay declining that half and leaving the screen
 * underneath — the list or the issue view — to keep it. Thunks rather than
 * elements so that only the half actually drawn is built, which is what lets
 * `comment` and `close` keep asserting a selection they are only reachable
 * with.
 */
interface OverlaySlots {
  body: (() => React.ReactElement) | null;
  footer: (() => React.ReactElement) | null;
}

/** What no overlay takes. */
const NO_OVERLAY: OverlaySlots = { body: null, footer: null };

/**
 * Header, status line, and the footer's own rows.
 *
 * `FOOTER_ROWS` is read rather than folded into a literal: the reservation here
 * and the number of lines `<Footer>` draws have to agree, so one imports the
 * other.
 */
const CHROME_ROWS = 2 + FOOTER_ROWS;
/** The rule <Detail> draws above itself. List screen only. */
const DETAIL_BORDER_ROWS = 1;

export function App({ project, initial, rows, width, onExit }: AppProps): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, initial);
  // Scratch for the two overlays that take a comment — `c` and the optional
  // comment on `x`. It never outlives them, so putting it in UiState would
  // mean every snapshot action had to decide what to do with a half-typed
  // sentence. Cleared on Esc and after a successful write, never on failure —
  // reopening after a failed write must show what was typed, not a blank line.
  const [draft, setDraft] = React.useState<string[]>(['']);
  // Which issue AND which overlay `draft` belongs to.
  //
  // The issue half stops a draft typed about one issue from being written to
  // another, since the error overlay leaves the list free to move. The
  // overlay half stops it crossing between `c` and `x`, which is reachable
  // with no Esc at all: a refused comment keeps its text on purpose, and the
  // very next `x` `^S` — "close as fixed, no comment" — would carry that text
  // into the log. Either half differing is enough to start over.
  const [draftFor, setDraftFor] = React.useState<null | { id: string; kind: DraftKind }>(null);
  // Where the close overlay's cursor is. Reset on every `x`, unlike the
  // resolution below: focus is not something the operator chose, it is where
  // they happened to be standing, and the picker is where every open starts.
  const [focus, setFocus] = React.useState<CloseFocus>('resolution');
  // The chosen resolution, keyed to `draftFor` exactly as `draft` is, and
  // reset in the same one place. The two are halves of one form: if the typed
  // reason comes back on reopen then the resolution has to come back with it.
  // Resetting only this half meant a refused `wontfix` reopened showing the
  // operator's own sentence over a picker silently back on `fixed`, which the
  // next ^S wrote.
  const [resolution, setResolution] = React.useState(0);
  const [form, setForm] = React.useState<FormState | null>(null);
  // How to run the write that is on screen again. Kept beside `draft` for the
  // same reason: it belongs to one attempt, not to the snapshot. `r` on the
  // waiting overlay needs the call itself — the op name cannot repeat it.
  const [retry, setRetry] = React.useState<(() => void) | null>(null);
  const visible = visibleIssues(state);
  const selected = selectedIssue(state);
  const me = React.useMemo(() => meAs(project.whoami()), [project]);
  // The error overlay only owns the keyboard and the footer on the list
  // screen. openIssue does not clear it, so without this the footer and the
  // Esc handler would each read `overlay` on its own and could disagree the
  // moment the operator opens the issue view with a stale error underneath.
  const errorActive = state.overlay?.kind === 'error' && state.screen === 'list';

  // Two panes plus CHROME_ROWS and the detail pane's own border. The list
  // gets the larger half because the detail pane reports how much it clipped
  // and the list cannot. The reservation is deliberately unconditional even
  // though <Notice> renders nothing when there is nothing to say: erring one
  // row short wastes a line, while erring one row long makes Ink scroll the
  // frame and the display stops matching the state.
  const listRows = Math.max(Math.floor((rows - CHROME_ROWS - DETAIL_BORDER_ROWS) * 0.6), 1);
  const detailRows = Math.max(rows - CHROME_ROWS - DETAIL_BORDER_ROWS - listRows, 1);

  const refresh = React.useCallback(() => {
    // An explicit refresh always supersedes whatever an earlier write
    // attempt was reporting — otherwise a stale write failure would occupy
    // the Notice line forever, and this refresh's own outcome, success or
    // failure, would never be seen. mutationFailed still owns setting the
    // error overlay in the first place; this only lets a later, competing
    // notice win instead of being computed and silently discarded.
    dispatch({ type: 'closeOverlay' });
    try {
      const { issues, failures } = project.list(SNAPSHOT_FILTER);
      dispatch({ type: 'snapshot', issues, failures });
    } catch (err) {
      // A refresh that throws must not take the UI down with it: the snapshot
      // already on screen is still perfectly readable.
      dispatch({ type: 'notice', text: `refresh failed: ${(err as Error).message}` });
    }
  }, [project]);

  /**
   * Readies the shared draft for the overlay about to open.
   *
   * A leftover draft is only worth keeping for the issue it was typed about
   * and the overlay it was typed in; anything else must start blank.
   *
   * The close overlay's resolution is part of that draft and is cleared here,
   * and only here. Deciding in two places when a form counts as new is how the
   * two halves came to disagree — the text restored and the resolution reset.
   */
  const startDraft = React.useCallback((kind: DraftKind) => {
    if (selected === null) return;
    if (draftFor?.id === selected.id && draftFor.kind === kind) return;
    setDraft(['']);
    setResolution(0);
    setDraftFor({ id: selected.id, kind });
  }, [selected, draftFor]);

  /** Runs a write and remembers how to run it again. */
  const write = React.useCallback((op: string, call: () => void) => {
    // Stored as a thunk-returning-thunk: useState calls a bare function
    // argument instead of storing it, which would run the mutation on the
    // spot and lose the retry.
    setRetry(() => () => { runMutation(project, dispatch, op, call, Date.now); });
    runMutation(project, dispatch, op, call, Date.now);
  }, [project]);

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
    // One correlated value rather than a mode beside a nullable issue, so the
    // state cannot hold `set` with nothing to diff against. This is also the
    // only place the two are chosen, which is why the refusal lives here.
    let subject: FormSubject;
    if (mode === 'add') {
      subject = { mode: 'add', issue: null };
    } else {
      if (selected === null) return;
      subject = { mode: 'set', issue: selected };
    }
    // The form this open will show: the one still held, or none. Decided
    // before the height check, because the height check has to measure what
    // is about to be drawn — see below.
    //
    // `form.mode === mode` is redundant, and is kept deliberately. Both
    // `FormState` and `FormSubject` are the same discriminated union, so a
    // `set` always carries an issue and an `add` never does, and `mode` is
    // `subject.mode`: whenever the id comparison below holds, either both
    // sides are null — two `add`s — or both are ids, which only two `set`s
    // can be. So the conjunct cannot change the answer. It is left in because
    // it says the intended rule out loud, where the id comparison only
    // implies it, and a reader who deletes it has to re-derive that proof.
    // A task brief has already mistaken it for load bearing once.
    const kept = form !== null && form.mode === mode
      && (form.issue?.id ?? null) === (subject.issue?.id ?? null)
      ? form
      : null;
    let choices: FormChoices;
    if (kept !== null) {
      // A kept form keeps the choices it opened with, so the config is not
      // read at all here. Two reasons, and the second is the one that bites:
      // a second `choices` object would be a second answer to what the form
      // offers, which this project's rule forbids outright; and a read that
      // has started failing — or merely grown — would then decide whether a
      // form the operator can already see is allowed to reopen.
      choices = kept.choices;
    } else {
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
      choices = choicesFor(subject.issue, components);
    }
    if (listRows + detailRows < formRows(mode, choices)) {
      // Measured against the choices being drawn, never a freshly read set
      // that is then discarded. Components added between a refused write and
      // the reopen would otherwise refuse the retained form on a height it is
      // never going to need — and a refusal does not open the form, so `esc`
      // cannot reach it either and the retained edits are lost for good.
      //
      // The same budget `x` compares against, deliberately: HANDOFF.md
      // records that it is conservative — for the close overlay, measured, by
      // two rows with no notice showing and one with — and a second, looser
      // one computed here would be a second rule to keep true.
      dispatch({ type: 'closeOverlay' });
      dispatch({ type: 'notice', text: FORM_TOO_SHORT });
      return;
    }
    if (kept === null) {
      setForm({
        ...subject,
        values: subject.issue === null ? EMPTY_VALUES : valuesOf(subject.issue),
        focus: fieldsFor(mode)[0]!,
        choices,
      });
    }
    dispatch({ type: 'openForm', mode });
  }, [project, selected, form, listRows, detailRows]);

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
    // No `!`. The `add` arm returned above, so `open` is narrowed to the
    // `set` member of `FormSubject` here and `open.issue` is an `Issue`.
    //
    // The baseline is `open.issue` and not the current selection: the values
    // being diffed were typed over that same read, and pairing them with a
    // fresher one is how a correct compare-and-swap was once handed a stale
    // issue with a fresh baseline.
    const original = open.issue;
    const changed = changedFields(valuesOf(original), open.values);
    if (isUnchanged(changed)) {
      // Not a write. `setFields` refuses an empty patch and is right to, but
      // taking the project lock in order to be told what the form already
      // knows would make an idle ^S contend with an agent.
      //
      // An emptied title is deliberately NOT pre-empted the same way. That
      // rule is `setField`'s, and a copy of it here would be two spellings of
      // one rule with no way to keep them equal; the facade refuses, the
      // message is relayed, and the form comes back holding the edit.
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

  // The elapsed line is the only thing on the waiting overlay that changes
  // without a keystroke, so the overlay drives its own repaint. Cleared when
  // it closes: without that the interval outlives the overlay and keeps waking
  // a component that has nothing to redraw.
  React.useEffect(() => {
    if (state.overlay?.kind !== 'waiting') return undefined;
    const id = setInterval(() => { dispatch({ type: 'retryTick', at: Date.now() }); }, 1000);
    return () => { clearInterval(id); };
  }, [state.overlay?.kind]);

  useInput((input, key) => {
    // Help first, because it takes the arrow keys for its own scrolling. If
    // the generic arrow handling below ran first, the keys would move a
    // selection nobody can see while the help sat still.
    if (state.overlay?.kind === 'help') {
      const max = maxHelpOffset(listRows + detailRows);
      if (key.downArrow || input === 'j') { dispatch({ type: 'scrollHelp', delta: 1, max }); return; }
      if (key.upArrow || input === 'k') { dispatch({ type: 'scrollHelp', delta: -1, max }); return; }
      if (key.pageDown || (key.ctrl && input === 'd')) {
        dispatch({ type: 'scrollHelp', delta: listRows + detailRows, max }); return;
      }
      if (key.pageUp || (key.ctrl && input === 'u')) {
        dispatch({ type: 'scrollHelp', delta: -(listRows + detailRows), max }); return;
      }
      if (key.home) { dispatch({ type: 'scrollHelp', delta: -max, max }); return; }
      if (key.end) { dispatch({ type: 'scrollHelp', delta: max, max }); return; }
      if (input === '?' || key.escape || input === 'q') dispatch({ type: 'toggleHelp' });
      return;
    }

    // The issue screen owns the keyboard too, and for the same reason: its
    // arrows scroll the body, not the list selection behind it.
    if (state.screen === 'issue') {
      const issue = selected;
      if (issue === null) { dispatch({ type: 'closeIssue' }); return; }
      const body = rows - CHROME_ROWS;
      const max = maxIssueOffset(issueLines(issue, width).length, body);
      if (key.downArrow || input === 'j') { dispatch({ type: 'scrollIssue', delta: 1, max }); return; }
      if (key.upArrow || input === 'k') { dispatch({ type: 'scrollIssue', delta: -1, max }); return; }
      if (key.pageDown || (key.ctrl && input === 'd')) {
        dispatch({ type: 'scrollIssue', delta: body, max }); return;
      }
      if (key.pageUp || (key.ctrl && input === 'u')) {
        dispatch({ type: 'scrollIssue', delta: -body, max }); return;
      }
      if (key.home || input === 'g') { dispatch({ type: 'scrollIssue', delta: -max, max }); return; }
      if (key.end || input === 'G') { dispatch({ type: 'scrollIssue', delta: max, max }); return; }
      if (input === '?') { dispatch({ type: 'toggleHelp' }); return; }
      if (key.escape || key.return || input === 'q') dispatch({ type: 'closeIssue' });
      return;
    }

    // The comment overlay owns the keyboard too, and for the same reason:
    // its own branch must run before the shared arrow handling below, or the
    // arrows would move the list selection hidden behind the open entry.
    if (state.overlay?.kind === 'comment') {
      if (key.escape) { setDraft(['']); dispatch({ type: 'closeOverlay' }); return; }
      if (key.ctrl && input === 's') {
        const issue = selectedIssue(state);
        const text = draft.join('\n').trim();
        // Empty is not a comment. Silently ignoring the keypress is right:
        // there is nothing to report and nothing was lost.
        if (issue === null || text === '') return;
        setDraftFor({ id: issue.id, kind: 'comment' });
        write('comment', () => {
          project.comment(issue.id, text);
          // Inside the call, not after it: `r` on the waiting overlay runs
          // this same thunk, so a retry that finally succeeds has to clear the
          // draft too. A refusal throws on the line above and the text
          // survives, which is the whole reason it is kept.
          setDraft(['']);
        });
        return;
      }
      const edited = handleEntryKey(draft, input, key);
      if (edited !== null) setDraft(edited);
      return;
    }

    // The close overlay owns the keyboard for the same reason, and its
    // resolution picker is a second thing the arrows would otherwise reach
    // past.
    if (state.overlay?.kind === 'close') {
      if (key.escape) { setDraft(['']); dispatch({ type: 'closeOverlay' }); return; }
      if (key.tab) { setFocus(focus === 'resolution' ? 'comment' : 'resolution'); return; }
      if (key.ctrl && input === 's') {
        const issue = selectedIssue(state);
        if (issue === null) return;
        const text = draft.join('\n').trim();
        // null, not '': the facade spells "no comment" as null everywhere
        // else, and '' would append a blank log entry nobody can delete.
        const note = text === '' ? null : text;
        setDraftFor({ id: issue.id, kind: 'close' });
        write('close', () => {
          project.close(issue.id, RESOLUTIONS[resolution]!, note);
          // Inside the call, for the same reason as the comment overlay: `r`
          // on the waiting overlay runs this same thunk, and the two overlays
          // share `draft`, so text a successful close consumed must not be
          // offered again by the next `c`.
          setDraft(['']);
        });
        return;
      }
      // Inside the focus check, not above it: a picker that keeps moving
      // while the comment field has focus turns `down` into a resolution the
      // operator did not choose.
      if (focus === 'resolution') {
        if (key.downArrow) { setResolution(moveSelection(resolution, 1, RESOLUTIONS.length)); return; }
        if (key.upArrow) { setResolution(moveSelection(resolution, -1, RESOLUTIONS.length)); return; }
        return;
      }
      const edited = handleEntryKey(draft, input, key);
      if (edited !== null) setDraft(edited);
      return;
    }

    // The form owns the keyboard for the third time and the same reason: its
    // pickers are what the arrows move, and the list must not move under them.
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
        if (key.downArrow) {
          setForm({ ...form, values: pick(form.values, form.choices, form.focus, 1) });
          return;
        }
        if (key.upArrow) {
          setForm({ ...form, values: pick(form.values, form.choices, form.focus, -1) });
          return;
        }
        return;
      }
      const edited = handleLineKey(text, input, key);
      if (edited !== null) {
        setForm({ ...form, values: typeInto(form.values, form.focus, edited) });
      }
      return;
    }

    // The wait owns the keyboard whole, and `r` is why it has to: the list's
    // `r` is refresh, and refresh dispatches closeOverlay, which nulls
    // waitingFor as well as overlay. Falling through would cancel the very
    // wait the key was pressed to repeat, and the cancellation would be
    // indistinguishable from giving up.
    if (state.overlay?.kind === 'waiting') {
      if (input === 'r') { retry?.(); return; }
      if (key.escape || input === 'q') { dispatch({ type: 'closeOverlay' }); return; }
      return;
    }

    // Partial on purpose: only Esc belongs to this overlay. Every other key
    // must fall through to the list below, which stays fully interactive
    // while the message is up — there is no other handler further down that
    // would otherwise dismiss it. Gated on errorActive, not the bare overlay
    // kind, so Esc on the issue screen still closes the issue (its own branch
    // above already does that) rather than racing this one.
    if (errorActive && key.escape) {
      dispatch({ type: 'closeOverlay' });
      return;
    }

    // Arrows and Home/End stay navigation everywhere else, including inside
    // the filter field — they are keys, not text, which is exactly why they
    // are the documented bindings and g/G/j/k are the letter aliases. Ink
    // 6.8.0 reports Home/End as dedicated key.home/key.end booleans (not
    // key.meta), confirmed by reading node_modules/ink/build/hooks/use-input.d.ts.
    if (key.downArrow) { dispatch({ type: 'move', delta: 1 }); return; }
    if (key.upArrow) { dispatch({ type: 'move', delta: -1 }); return; }
    if (key.pageDown) { dispatch({ type: 'move', delta: listRows }); return; }
    if (key.pageUp) { dispatch({ type: 'move', delta: -listRows }); return; }
    if (key.end) { dispatch({ type: 'jump', to: 'last' }); return; }
    if (key.home) { dispatch({ type: 'jump', to: 'first' }); return; }

    if (state.overlay?.kind === 'filter') {
      if (key.return) { dispatch({ type: 'closeFilter' }); return; }
      if (key.escape) {
        dispatch({ type: 'clearFilter' });
        dispatch({ type: 'closeFilter' });
        return;
      }
      if (key.backspace || key.delete) {
        dispatch({ type: 'setQuery', text: state.query.slice(0, -1), me });
        return;
      }
      // Control characters are not text. Without this, a stray ^C or an
      // unhandled escape sequence lands in the filter as garbage.
      if (input !== '' && !key.ctrl && !key.meta) {
        dispatch({ type: 'setQuery', text: state.query + input, me });
      }
      return;
    }

    if (input === 'j') { dispatch({ type: 'move', delta: 1 }); return; }
    if (input === 'k') { dispatch({ type: 'move', delta: -1 }); return; }
    if (key.ctrl && input === 'd') { dispatch({ type: 'move', delta: listRows }); return; }
    if (key.ctrl && input === 'u') { dispatch({ type: 'move', delta: -listRows }); return; }
    if (input === 'G') { dispatch({ type: 'jump', to: 'last' }); return; }
    if (input === 'g') { dispatch({ type: 'jump', to: 'first' }); return; }
    if (input === '/') { dispatch({ type: 'openFilter' }); return; }
    if (input === 'r') { refresh(); return; }
    if (input === '?') { dispatch({ type: 'toggleHelp' }); return; }
    if (input === 'c') { startDraft('comment'); dispatch({ type: 'openComment' }); return; }
    if (input === 'n') { startForm('add'); return; }
    if (input === 'x') {
      // The close form has a floor it cannot draw below, and an overlay taller
      // than its budget is the frame-scrolling failure listRows guards
      // against. Refusing to open it and saying so is the honest answer; a
      // form whose bottom half is off the screen is not.
      if (listRows + detailRows < CLOSE_OVERLAY_ROWS) {
        // The error overlay would otherwise outrank this on the one status
        // line and the keypress would look ignored. Clearing it is also what
        // the opening path does — openClose replaces the error overlay
        // outright — so both answers to `x` leave the same screen behind.
        dispatch({ type: 'closeOverlay' });
        dispatch({ type: 'notice', text: CLOSE_TOO_SHORT });
        return;
      }
      startDraft('close');
      setFocus('resolution');
      dispatch({ type: 'openClose' });
      return;
    }
    // Shift-Tab does nothing on the list. Deliberate rather than an oversight:
    // it is the form's *back*, and a stray one arriving after Esc must not
    // reopen what it just closed.
    if (key.tab && !key.shift) { startForm('set'); return; }
    if (key.return) { dispatch({ type: 'openIssue' }); return; }
    if (input === 'q') { onExit(); }
  });

  const onIssueScreen = state.screen === 'issue' && selected !== null;

  // The screen an overlay is drawn over, in the same two slots an overlay can
  // take. Whichever half an overlay claims is never built.
  const screenBody = (): React.ReactElement => (onIssueScreen
    ? (
      <IssueView issue={selected!} offset={state.issueOffset}
        rows={rows - CHROME_ROWS} width={width} />
    )
    : (
      <>
        <IssueList issues={visible} selectedId={state.selectedId}
          rows={listRows} width={width} />
        <Detail issue={selected} rows={detailRows} width={width} />
      </>
    ));
  const screenFooter = (): React.ReactElement => (
    <Footer keys={onIssueScreen ? ISSUE_KEYS : LIST_KEYS} width={width} />
  );

  // A local const so the null check below narrows inside the thunk. Narrowing
  // a property access does not survive into a closure; narrowing a const does.
  const waitingFor = state.waitingFor;

  /**
   * What each overlay takes from the screen underneath it.
   *
   * One table rather than two parallel chains. Two chains is how `ERROR_KEYS`
   * came to outrank the issue screen in the footer while the body underneath
   * was still the issue view: each chain spelled out a precedence the other
   * could not see, and nothing made them agree. Overlay kinds are mutually
   * exclusive — `UiState.overlay` is one object — so no ordering between
   * overlays survives to be got wrong, and the only precedence question left,
   * whether an overlay outranks the screen it covers, is answered once per row
   * and for both slots at the same time.
   *
   * `Record<OverlayKind, …>` and not a partial map: a kind added to `UiState`
   * does not compile until both of its slots have been decided, here.
   */
  const overlays: Record<OverlayKind, OverlaySlots> = {
    // A field, not a screen: it replaces the footer and leaves the list up.
    filter: {
      body: null,
      footer: () => <FilterField query={state.query} width={width} />,
    },
    // The reverse — help fills the body and leaves the footer describing the
    // screen it is over, which is the screen `?` brings back.
    help: {
      body: () => (
        <HelpOverlay
          // The issue screen has no detail border, so its body is a row
          // taller than the list screen's two panes. Passing the list's
          // budget from either screen wasted that row.
          rows={state.screen === 'issue' ? rows - CHROME_ROWS : listRows + detailRows}
          offset={state.helpOffset}
          width={width}
        />
      ),
      footer: null,
    },
    comment: {
      // Only reachable with a real selection: openComment is a no-op
      // otherwise, so the overlay never opens without one.
      body: () => (
        <CommentOverlay issue={selected!} lines={draft}
          rows={listRows + detailRows} width={width} />
      ),
      footer: () => <Footer keys={COMMENT_KEYS} width={width} />,
    },
    close: {
      // Only reachable with a real selection, exactly as above: openClose is
      // the same no-op on an empty list.
      body: () => (
        <CloseOverlay issue={selected!} resolution={resolution} lines={draft}
          focus={focus} rows={listRows + detailRows} width={width} />
      ),
      footer: () => <Footer keys={CLOSE_KEYS} width={width} />,
    },
    // Only reachable with a form: startForm sets one before dispatching
    // openForm, and Esc and a successful save clear both. The null arm cannot
    // be produced today and is here for the reason the waiting row's is —
    // the two live in different stores and this is the only place that reads
    // them together.
    form: {
      // Spread, not prop-by-prop: `mode` and `issue` are one discriminated
      // choice in FormOverlay's props, and forwarding them as two separate
      // JSX attributes loses the correlation and does not compile.
      body: form === null ? null : () => (
        <FormOverlay {...form} width={width} />
      ),
      footer: () => <Footer keys={FORM_KEYS} width={width} />,
    },
    waiting: {
      // mutationLocked is the only producer of this overlay and it sets
      // waitingFor in the same step, so the null body is unreachable; it is
      // here because the two fields are separate in UiState and this is the
      // only place that reads them together. Null leaves the screen showing
      // under a footer that still says `r retry` — the same answer the chain
      // this replaces gave, since only its body arm tested waitingFor.
      body: waitingFor === null ? null : () => (
        <WaitingOverlay
          op={waitingFor.op}
          holder={waitingFor.holder}
          since={waitingFor.since}
          // Read at render time rather than stored: `retryTick` exists
          // to force this re-read once a second, and a second copy of
          // the clock in UiState would be one more thing to keep true.
          now={Date.now()}
          attempts={waitingFor.attempts}
          width={width}
        />
      ),
      footer: () => <Footer keys={WAITING_KEYS} width={width} />,
    },
    // The one overlay that must not outrank the screen. It is a status line
    // and not a modal: the body stays whatever it was, and the footer is
    // claimed only where `Esc` really does dismiss the message. `errorActive`
    // is the predicate the keyboard handler is gated on, so the footer cannot
    // advertise `esc dismiss` on a screen where Esc means something else.
    error: {
      body: null,
      footer: errorActive ? () => <Footer keys={ERROR_KEYS} width={width} /> : null,
    },
  };

  const slots = state.overlay === null ? NO_OVERLAY : overlays[state.overlay.kind];

  return (
    <Box flexDirection="column">
      {onIssueScreen
        ? (
          <Text bold wrap="truncate">
            {truncate(`ditz2 · ${project.name} · ${shortId(selected!.id)}`, width)}
          </Text>
        )
        : (
          <Header
            name={project.name}
            shown={visible.length}
            total={state.snapshot.length}
            query={state.query}
            width={width}
          />
        )}
      {(slots.body ?? screenBody)()}
      <Notice
        text={state.overlay?.kind === 'error' ? state.overlay.message : state.notice}
        error={state.queryError}
        unreadable={state.failures.length}
        width={width}
      />
      {(slots.footer ?? screenFooter)()}
    </Box>
  );
}
