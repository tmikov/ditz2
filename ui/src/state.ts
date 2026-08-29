/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { applyFilter, matchIssues, shortId } from 'ditz2';
import type { Filter, Issue, LoadFailure } from 'ditz2';
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
  overlay: null | { kind: 'filter' } | { kind: 'help' };
  /** First visible help line. Only meaningful while the help overlay is open. */
  helpOffset: number;
  /** First visible issue-view line. Only meaningful while `screen` is 'issue'. */
  issueOffset: number;
  notice: string | null;
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
  | { type: 'notice'; text: string | null };

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
  }
}
