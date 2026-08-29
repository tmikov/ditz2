/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, Text, useInput } from 'ink';
import React, { useReducer } from 'react';
import { shortId } from 'ditz2';
import type { Project } from 'ditz2';
import { Detail } from './components/Detail.js';
import { Footer, Header, Notice } from './components/Chrome.js';
import { FilterField } from './components/FilterField.js';
import { HelpOverlay, maxHelpOffset } from './components/HelpOverlay.js';
import { IssueList } from './components/IssueList.js';
import { IssueView, maxIssueOffset } from './components/IssueView.js';
import { issueLines, truncate } from './format.js';
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

const LIST_KEYS = 'up/down move  / filter  r refresh  ? help  q quit';
const ISSUE_KEYS = 'up/down scroll  g/G top/bottom  enter/esc back  ? help  q back';

/** Header, status line, footer — present on every screen. */
const CHROME_ROWS = 3;
/** The rule <Detail> draws above itself. List screen only. */
const DETAIL_BORDER_ROWS = 1;

export function App({ project, initial, rows, width, onExit }: AppProps): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, initial);
  const visible = visibleIssues(state);
  const selected = selectedIssue(state);
  const me = React.useMemo(() => meAs(project.whoami()), [project]);

  // Two panes plus CHROME_ROWS and the detail pane's own border. The list
  // gets the larger half because the detail pane reports how much it clipped
  // and the list cannot. The reservation is deliberately unconditional even
  // though <Notice> renders nothing when there is nothing to say: erring one
  // row short wastes a line, while erring one row long makes Ink scroll the
  // frame and the display stops matching the state.
  const listRows = Math.max(Math.floor((rows - CHROME_ROWS - DETAIL_BORDER_ROWS) * 0.6), 1);
  const detailRows = Math.max(rows - CHROME_ROWS - DETAIL_BORDER_ROWS - listRows, 1);

  const refresh = React.useCallback(() => {
    try {
      const { issues, failures } = project.list(SNAPSHOT_FILTER);
      dispatch({ type: 'snapshot', issues, failures });
    } catch (err) {
      // A refresh that throws must not take the UI down with it: the snapshot
      // already on screen is still perfectly readable.
      dispatch({ type: 'notice', text: `refresh failed: ${(err as Error).message}` });
    }
  }, [project]);

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
    if (key.return) { dispatch({ type: 'openIssue' }); return; }
    if (input === 'q') { onExit(); }
  });

  const onIssueScreen = state.screen === 'issue' && selected !== null;

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
      {state.overlay?.kind === 'help'
        ? (
          <HelpOverlay
            // The issue screen has no detail border, so its body is a row
            // taller than the list screen's two panes. Passing the list's
            // budget from either screen wasted that row.
            rows={state.screen === 'issue' ? rows - CHROME_ROWS : listRows + detailRows}
            offset={state.helpOffset}
            width={width}
          />
        )
        : onIssueScreen
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
          )}
      <Notice
        text={state.notice}
        error={state.queryError}
        unreadable={state.failures.length}
        width={width}
      />
      {state.overlay?.kind === 'filter'
        ? <FilterField query={state.query} width={width} />
        : <Footer keys={onIssueScreen ? ISSUE_KEYS : LIST_KEYS} width={width} />}
    </Box>
  );
}
