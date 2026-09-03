/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { applyFilter, matchIssues, shortId } from 'ditz2';
import type { Filter, Issue, LoadFailure, LockInfo } from 'ditz2';
// Type-only, so the reducer keeps no runtime dependency on the form module or
// the Ink components behind it. `FormMode` is imported rather than respelled
// as `'set' | 'add'`: a third mode would then be a compile error here instead
// of a silently narrower action.
import type { FormMode } from './form.js';
import { parseQuery } from './query.js';

export interface UiState {
  /** Replaced wholesale on refresh; never mutated in place. */
  snapshot: Issue[];
  failures: LoadFailure[];
  /** The raw text of the / field. */
  query: string;
  /** The last filter that parsed and validated. */
  filter: Filter;
  pattern: string | null;
  queryError: string | null;
  selectedId: string | null;
  screen: 'list' | 'issue';
  overlay:
    | null
    | { kind: 'filter' }
    | { kind: 'help' }
    | { kind: 'comment' }
    | { kind: 'close' }
    | { kind: 'form' }
    | { kind: 'waiting' }
    | { kind: 'error'; message: string };
  /** First visible help line. Only meaningful while the help overlay is open. */
  helpOffset: number;
  /** First visible issue-view line. Only meaningful while `screen` is 'issue'. */
  issueOffset: number;
  notice: string | null;
  /** A write is in flight. Set between the call and its outcome. */
  pending: null | { op: string };
  /**
   * A write refused because another process holds the lock. `since` is the
   * first refusal, not the latest, so the elapsed display keeps counting
   * across retries instead of restarting.
   */
  waitingFor: null | {
    op: string;
    /** null when the lock file exists but could not be parsed. */
    holder: LockInfo | null;
    since: number;
    attempts: number;
  };
}

/**
 * What every load asks for.
 *
 * Everything, closed issues included. applyFilter hides closed issues unless
 * asked, so narrowing at load time would put them beyond the reach of the
 * in-memory filter — `all:true` in the field would silently show nothing new.
 */
export const SNAPSHOT_FILTER: Filter = { all: true };

export type UiAction =
  | { type: 'snapshot'; issues: Issue[]; failures: LoadFailure[] }
  | { type: 'move'; delta: number }
  | { type: 'jump'; to: 'first' | 'last' }
  | { type: 'openFilter' }
  | { type: 'setQuery'; text: string; me: string | null }
  | { type: 'closeFilter' }
  | { type: 'clearFilter' }
  | { type: 'toggleHelp' }
  | { type: 'scrollHelp'; delta: number; max: number }
  | { type: 'openIssue' }
  | { type: 'closeIssue' }
  | { type: 'scrollIssue'; delta: number; max: number }
  | { type: 'notice'; text: string | null }
  | { type: 'openComment' }
  | { type: 'openClose' }
  | { type: 'openForm'; mode: FormMode }
  | { type: 'select'; id: string }
  | { type: 'closeOverlay' }
  | { type: 'mutationStarted'; op: string }
  | { type: 'mutationLocked'; op: string; holder: LockInfo | null; at: number }
  | { type: 'mutationFailed'; op: string; message: string }
  | { type: 'mutationSucceeded'; issues: Issue[]; failures: LoadFailure[] }
  | { type: 'retryTick'; at: number };

/**
 * Derived, never stored. A stored copy would be one more thing that can
 * disagree with the filter that produced it.
 *
 * Total by construction: `filter` and `pattern` are only ever assigned values
 * that already validated, so neither call here can throw.
 */
export function visibleIssues(state: UiState): Issue[] {
  const filtered = applyFilter(state.snapshot, state.filter);
  return state.pattern === null ? filtered : matchIssues(filtered, state.pattern);
}

export function selectedIssue(state: UiState): Issue | null {
  if (state.selectedId === null) return null;
  return visibleIssues(state).find((i) => i.id === state.selectedId) ?? null;
}

/**
 * Puts the cursor back on something real.
 *
 * `report` is true only for a refresh: an issue vanishing under the cursor
 * because someone else closed it is news, whereas one disappearing because the
 * operator narrowed the filter is the filter working.
 */
function reselect(state: UiState, report: boolean): UiState {
  const visible = visibleIssues(state);
  if (state.selectedId !== null && visible.some((i) => i.id === state.selectedId)) {
    return state;
  }
  const lost = state.selectedId;
  // No early return for an empty list. A refresh that empties the list loses
  // the selection just as surely as one that merely reorders it, and it is the
  // same news; an early return here reported the partial case and silently
  // dropped the total one.
  return {
    ...state,
    selectedId: visible[0]?.id ?? null,
    notice: report && lost !== null
      ? `${shortId(lost)} is no longer in the list`
      : state.notice,
  };
}

export function initialState(issues: Issue[], failures: LoadFailure[]): UiState {
  return reselect({
    snapshot: issues,
    failures,
    query: '',
    filter: {},
    pattern: null,
    queryError: null,
    selectedId: null,
    screen: 'list',
    overlay: null,
    helpOffset: 0,
    issueOffset: 0,
    notice: null,
    pending: null,
    waitingFor: null,
  }, false);
}

/**
 * Whether ditz2 accepts this filter and pattern, as a message or null.
 *
 * Probed against an empty array: applyFilter checks its vocabulary and
 * matchIssues compiles its regex before either looks at an issue, so this costs
 * nothing and cannot be fooled by a snapshot that happens to be empty.
 */
function rejects(filter: Filter, pattern: string | null): string | null {
  try {
    applyFilter([], filter);
    if (pattern !== null) matchIssues([], pattern);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

/** The overlay each opening action asks for. */
const OPENS: Record<'openComment' | 'openClose' | 'openForm', 'comment' | 'close' | 'form'> = {
  openComment: 'comment', openClose: 'close', openForm: 'form',
};

export function reducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'snapshot':
      // notice cleared here, not in reselect: a snapshot arriving at all means
      // the load succeeded, so whatever the last one said — "refresh failed",
      // or an issue that has since come back — no longer describes the screen.
      // reselect sets a fresh one if the selection was lost.
      return reselect(
        { ...state, snapshot: action.issues, failures: action.failures, notice: null },
        true,
      );

    case 'move': {
      const visible = visibleIssues(state);
      if (visible.length === 0) return state;
      const at = visible.findIndex((i) => i.id === state.selectedId);
      const next = Math.min(Math.max((at < 0 ? 0 : at) + action.delta, 0), visible.length - 1);
      return { ...state, selectedId: visible[next]!.id };
    }

    case 'jump': {
      const visible = visibleIssues(state);
      if (visible.length === 0) return state;
      const pick = action.to === 'first' ? visible[0]! : visible[visible.length - 1]!;
      return { ...state, selectedId: pick.id };
    }

    case 'setQuery': {
      const { filter, pattern } = parseQuery(action.text, action.me);
      const queryError = rejects(filter, pattern);
      // On a rejected query the text is kept — the operator is mid-word — but
      // the filter is not, so the list stays on the last thing that made sense
      // rather than emptying while they type.
      if (queryError !== null) return { ...state, query: action.text, queryError };
      return reselect({ ...state, query: action.text, filter, pattern, queryError: null }, false);
    }

    case 'clearFilter':
      return reselect(
        { ...state, query: '', filter: {}, pattern: null, queryError: null },
        false,
      );

    case 'openFilter':
      return { ...state, overlay: { kind: 'filter' } };

    case 'closeFilter':
      return { ...state, overlay: null };

    case 'toggleHelp':
      return {
        ...state,
        overlay: state.overlay?.kind === 'help' ? null : { kind: 'help' },
        // Reopening help starts at the top rather than wherever it was left.
        helpOffset: 0,
      };

    case 'scrollHelp':
      return {
        ...state,
        helpOffset: Math.min(Math.max(state.helpOffset + action.delta, 0), Math.max(action.max, 0)),
      };

    case 'openIssue':
      // Only from a real selection; Enter on an empty list must do nothing.
      if (selectedIssue(state) === null) return state;
      return { ...state, screen: 'issue', issueOffset: 0 };

    case 'closeIssue':
      return { ...state, screen: 'list' };

    case 'scrollIssue':
      return {
        ...state,
        issueOffset: Math.min(Math.max(state.issueOffset + action.delta, 0), Math.max(action.max, 0)),
      };

    case 'notice':
      return { ...state, notice: action.text };

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

    case 'closeOverlay':
      return { ...state, overlay: null, waitingFor: null };

    case 'mutationStarted': {
      // Clears any previous error: the operator has moved on, and a message
      // about the last attempt would now be describing nothing.
      //
      // waitingFor survives exactly one case: a retry of the wait still on
      // screen. runMutation opens every call with this action, retries
      // included, so clearing it unconditionally restarted both the elapsed
      // timer and the attempt count on every press of r — undoing the whole
      // reason mutationLocked keeps the first `since`. Keeping it
      // unconditionally is the opposite mistake: a wait left behind by
      // openFilter, closeFilter, toggleHelp or openIssue, none of which clear
      // it, would hand its timer and its count to the next write. Both halves
      // of the condition are decided here rather than assumed from what the
      // keyboard handler happens to let through.
      const retrying = state.overlay?.kind === 'waiting' && state.waitingFor?.op === action.op;
      return {
        ...state,
        pending: { op: action.op },
        overlay: null,
        waitingFor: retrying ? state.waitingFor : null,
      };
    }

    case 'mutationLocked': {
      // Only a wait for THIS op may hand over its clock and its count.
      // Without the comparison the property held only because mutationStarted,
      // one case above, nulls waitingFor for a different op — so a case that
      // decides nothing would have been relying on a case that decides
      // everything, and the reducer's guarantee would live outside it. It
      // already refuses to take the keyboard handler's word for the same
      // question; the neighbouring case is no better a witness.
      const carry = state.waitingFor?.op === action.op ? state.waitingFor : null;
      return {
        ...state,
        pending: null,
        overlay: { kind: 'waiting' },
        waitingFor: {
          op: action.op,
          holder: action.holder,
          since: carry?.since ?? action.at,
          attempts: (carry?.attempts ?? 0) + 1,
        },
      };
    }

    case 'mutationFailed':
      return {
        ...state,
        pending: null,
        waitingFor: null,
        overlay: { kind: 'error', message: action.message },
      };

    case 'mutationSucceeded':
      return reselect({
        ...state,
        snapshot: action.issues,
        failures: action.failures,
        pending: null,
        waitingFor: null,
        overlay: null,
        notice: null,
      }, true);

    case 'retryTick':
      return state.waitingFor === null ? state : { ...state };
  }
}
