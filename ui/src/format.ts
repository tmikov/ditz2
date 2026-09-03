/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { shortId } from 'ditz2';
import type { Issue, LogEntry } from 'ditz2';

const TYPE_WIDTH = 7;
const COMPONENT_WIDTH = 9;

/**
 * How this UI spells an issue nobody owns.
 *
 * Exported for the same reason `NO_COMPONENT` is: the detail line and the
 * form's assignee row have to agree, and two literals would be free to drift.
 * Cosmetic drift rather than the `dz doctor` kind — nothing decides anything
 * on this string — but one word in two voices is still one word too many.
 */
export const UNASSIGNED = 'unassigned';

/**
 * Exactly `width` characters, truncating as well as padding. Component names
 * are arbitrary user strings — `dz component add documentation` is legal — and
 * a value that overruns its column shifts every column after it on that row
 * only, which reads as corruption rather than as a long name.
 */
export function pad(value: string, width: number): string {
  if (value.length > width) return truncate(value, width);
  return value + ' '.repeat(width - value.length);
}

export function truncate(value: string, width: number): string {
  if (width <= 0) return '';
  return value.length <= width ? value : `${value.slice(0, width - 1)}…`;
}

/** Continuation indent for a wrapped list item, so it does not read as a new one. */
const BULLET = /^(\s*(?:[-*+]|\d+\.)\s+)/;

/**
 * One source line as one or more display lines of at most `width`.
 *
 * A Markdown paragraph is a single source line, so without this every
 * paragraph rendered as one truncated line and the rest of the text was
 * simply gone.
 *
 * The contract, stated exactly, because two earlier attempts at stating it
 * were both wrong in ways no test could see:
 *
 *   - Non-whitespace characters are conserved, in order. Concatenating the
 *     output and discarding whitespace reproduces the input with whitespace
 *     discarded. That holds for every input, including hard-broken ones.
 *   - A *token* survives whole only when it fits in `width`. One that does not
 *     is split across lines — `wrapLine('10. ' + 'x'.repeat(30), 2)` yields
 *     `['10', '.', 'xx', …]` — because the alternative is dropping its tail,
 *     which is the bug this function exists to fix.
 *   - Runs of whitespace between tokens collapse into the single space or line
 *     break that replaces them. That is what reflow means.
 *
 * The first version promised "every character survives" while eating leading
 * indents, whitespace-only lines and doubled spaces. The second promised each
 * token "exactly once, in order", which a hard break makes false. Character
 * conservation is the one that is actually true.
 */
export function wrapLine(line: string, width: number): string[] {
  if (width <= 0 || line.length <= width) return [line];
  // Whitespace-only lines are paragraph separators; reflowing one to nothing
  // silently closes the gap it exists to create.
  if (line.trim() === '') return [line];

  const lead = BULLET.exec(line)?.[1];
  const raw = lead ?? (/^\s*/.exec(line)?.[0] ?? '');
  // An indent at least as wide as the line leaves no room for text, and a
  // hanging indent re-added faster than characters are consumed does not
  // terminate. Measured before this guard existed: `wrapLine('10. ' +
  // 'x'.repeat(30), 2)` grew without bound. A synchronous loop here freezes
  // the whole UI, and Ink cannot service Ctrl-C while it spins.
  const indent = raw.length < width ? ' '.repeat(raw.length) : '';
  const out: string[] = [];
  let current = raw.length < width ? raw : '';
  let fresh = true;

  // When `raw` fit and was folded into `current` above, its own text (a
  // bullet marker is not whitespace) must not also appear as the loop's
  // first word, or the marker is emitted twice.
  const words = (raw.length < width ? line.slice(raw.length) : line)
    .trim().split(/\s+/).filter((w) => w.length > 0);
  for (const word of words) {
    const sep = fresh ? '' : ' ';
    if (current.length + sep.length + word.length <= width) {
      current += sep + word;
      fresh = false;
      continue;
    }
    if (!fresh) {
      out.push(current);
      current = indent;
      fresh = true;
    }
    // Still too long on a line of its own — a URL or a path. Break it rather
    // than overflow, which is the loss this whole task is about. `current` is
    // always narrower than `width` here, so each pass consumes at least one
    // character and the loop ends.
    let rest = word;
    while (current.length + rest.length > width) {
      const room = width - current.length;
      out.push(current + rest.slice(0, room));
      rest = rest.slice(room);
      current = indent;
    }
    current += rest;
    fresh = false;
  }

  if (current.trim() !== '' || out.length === 0) out.push(current);
  return out;
}

/**
 * One list row, as a single string.
 *
 * Built here rather than out of JSX children: Ink follows React's whitespace
 * rules, so the spaces between adjacent expressions are easy to lose and hard
 * to assert on. One string is both what is drawn and what a test reads.
 *
 * Truncated to `width` because a row that wraps pushes every row below it out
 * of place, and the frame then no longer corresponds to the list.
 */
export function rowFor(issue: Issue, selected: boolean, width: number): string {
  const row = `${selected ? '>' : ' '} ${shortId(issue.id)}  `
    + `${pad(issue.type, TYPE_WIDTH)}  ${pad(issue.component ?? '-', COMPONENT_WIDTH)}  `
    + `${issue.title}`;
  return truncate(row, width);
}

/**
 * The slice of a list to draw, as a half-open [from, to).
 *
 * Derived from the selected index every render rather than kept as scroll
 * state: a stored offset is a second thing that can disagree with the
 * selection, and it is the selection that is authoritative.
 */
export function windowOf(
  count: number,
  selected: number,
  rows: number,
): { from: number; to: number } {
  if (count <= 0 || rows <= 0) return { from: 0, to: 0 };
  if (count <= rows) return { from: 0, to: count };
  const at = Math.min(Math.max(selected, 0), count - 1);
  const from = Math.min(Math.max(at - rows + 1, 0), count - rows);
  return { from, to: from + rows };
}

function logLines(entry: LogEntry): string[] {
  const detail = entry.detail === null ? '' : `: ${entry.detail}`;
  const head = `${entry.timestamp}  ${entry.author}  ${entry.verb}${detail}`;
  if (entry.text === null) return [head];
  return [head, ...entry.text.split('\n').map((l) => `    ${l}`)];
}

/** Title and the one-line field summary. Shared so the two views cannot drift. */
function issueHead(issue: Issue): string[] {
  const resolution = issue.resolution === null ? '' : ` (${issue.resolution})`;
  return [
    issue.title,
    `${issue.status}${resolution} · ${issue.component ?? 'no component'} · `
    + `${issue.assignee ?? UNASSIGNED} · ${issue.type}`,
    '',
  ];
}

/** Lines kept for the newest log entries, however long the body is. */
const LOG_ROOM = 4;

/**
 * The detail pane, as exactly `rows` lines of at most `width` characters.
 *
 * The log is budgeted before the body, and it is the *newest* entries that are
 * kept. Appending body then log and clipping the tail — the obvious order —
 * lets a body of any length hide every comment on the issue, which is the half
 * most likely to have changed since the operator last looked at it.
 *
 * Padded as well as truncated: a pane that shrinks when an issue has no body
 * makes the footer jump around as the cursor moves down the list.
 */
export function detailLines(issue: Issue, rows: number, width: number): string[] {
  const head = issueHead(issue).flatMap((l) => wrapLine(l, width));
  // Per entry, so the whole-entry budgeting below measures DISPLAY lines. A
  // comment that reflows to six lines must count as six against LOG_ROOM, or
  // the pane budgets for one and overflows.
  const entries = issue.log.map((e) => logLines(e).flatMap((l) => wrapLine(l, width)));
  const logHeight = entries.reduce((n, e) => n + e.length, 0);
  const body = issue.body === '' ? [] : issue.body.split('\n').flatMap((l) => wrapLine(l, width));

  const logRoom = Math.min(logHeight, LOG_ROOM, Math.max(rows - head.length - 1, 0));

  // Whole entries, newest first. Slicing the flattened lines instead can leave
  // the tail of a multi-line comment with the timestamp, author and verb it
  // belongs to cut off above it — an unattributed fragment of somebody's text,
  // which is worse than not showing the entry at all.
  const shownLog: string[] = [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]!;
    if (shownLog.length + entry.length > logRoom) break;
    shownLog.unshift(...entry);
  }
  // Not even the newest entry fits: show as much of it as there is room for.
  // Before the log wrapped, the header was one line and this always showed it
  // whole, chopped only by the trailing truncate with a visible "…" marking
  // the loss. Now the header itself can wrap, so keeping only its first line
  // can be just a date with no time, author or verb. Taking `logRoom` lines
  // shows less at a very narrow pane, but not something that reads as more
  // than it is.
  if (shownLog.length === 0 && logRoom > 0 && entries.length > 0) {
    shownLog.push(...entries[entries.length - 1]!.slice(0, logRoom));
  }

  const bodyRoom = Math.max(rows - head.length - shownLog.length, 0);
  const shownBody = body.length <= bodyRoom
    ? body
    : [
      ...body.slice(0, Math.max(bodyRoom - 1, 0)),
      `… ${body.length - bodyRoom + 1} more lines`,
    ];

  const out = [...head, ...shownBody, ...shownLog];
  const padded = [...out, ...Array.from({ length: Math.max(rows - out.length, 0) }, () => '')];
  // Not dead weight: the `… N more lines` marker just above is built directly
  // rather than routed through wrapLine, so a large hidden count at a narrow
  // width can still exceed it. Truncating that marker is the right outcome —
  // wrapping it would spend a second row repeating the same message — so this
  // stays as the guard for exactly that one case, not a general display-width
  // mismatch.
  return padded.slice(0, rows).map((l) => truncate(l, width));
}

/**
 * The whole issue: every body line, every log entry, nothing budgeted away.
 * Only `width` constrains it — the caller scrolls.
 */
export function issueLines(issue: Issue, width: number): string[] {
  const body = issue.body === '' ? ['(no description)'] : issue.body.split('\n');
  const log = issue.log.flatMap(logLines);
  const out = [
    ...issueHead(issue),
    ...body,
    ...(log.length === 0 ? [] : ['', ...log]),
  ];
  return out.flatMap((l) => wrapLine(l, width));
}
