/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { parseLog, renderLog } from './log.js';
import type { LogEntry } from './types.js';

const AUTHOR = 'Tzvetan Mikov <tmikov@example.com>';

function entry(over: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: '2026-08-22T09:14:03.221Z',
    author: AUTHOR,
    verb: 'created',
    detail: null,
    text: null,
    ...over,
  };
}

describe('parseLog', () => {
  it('parses a bare verb with no detail', () => {
    const got = parseLog([`- 2026-08-22T09:14:03.221Z  ${AUTHOR}  created`], 'f.md');
    expect(got).toEqual([entry()]);
  });

  it('keeps single spaces in the author intact', () => {
    const got = parseLog([`- 2026-08-22T09:14:03.221Z  ${AUTHOR}  created`], 'f.md');
    expect(got[0].author).toBe(AUTHOR);
  });

  it('splits verb from detail on the first ": " only', () => {
    const got = parseLog(
      [`- 2026-08-22T11:02:55.010Z  ${AUTHOR}  status: in-progress -> closed (fixed)`],
      'f.md',
    );
    expect(got[0].verb).toBe('status');
    expect(got[0].detail).toBe('in-progress -> closed (fixed)');
  });

  it('attaches four-space continuation lines as comment text', () => {
    const got = parseLog(
      [
        `- 2026-08-22T11:40:12.887Z  ${AUTHOR}  comment`,
        "    Turns out it's the tokenizer, not the parser.",
        '    Second line.',
      ],
      'f.md',
    );
    expect(got[0].text).toBe("Turns out it's the tokenizer, not the parser.\nSecond line.");
  });

  it('preserves a blank line inside a comment when written as four spaces', () => {
    const got = parseLog(
      [`- 2026-08-22T11:40:12.887Z  ${AUTHOR}  comment`, '    one', '    ', '    two'],
      'f.md',
    );
    expect(got[0].text).toBe('one\n\ntwo');
  });

  it('ignores truly empty separator lines between entries', () => {
    const got = parseLog(
      [`- 2026-08-22T09:14:03.221Z  ${AUTHOR}  created`, '', `- 2026-08-22T09:15:00.000Z  ${AUTHOR}  comment`],
      'f.md',
    );
    expect(got).toHaveLength(2);
  });

  it('rejects a continuation line that precedes any entry', () => {
    expect(() => parseLog(['    orphan'], 'f.md')).toThrow(/continuation line/);
  });

  it('rejects a line that is neither an entry nor a continuation', () => {
    expect(() => parseLog(['garbage'], 'f.md')).toThrow(/unrecognized log line/);
  });

  it('rejects an entry missing its author separator', () => {
    expect(() => parseLog(['- 2026-08-22T09:14:03.221Z created'], 'f.md')).toThrow(
      /malformed log entry/,
    );
  });

  it('rejects a verb that is not lowercase letters, naming it', () => {
    // What a double space inside the author degrades into: the tail of the
    // author silently becomes the verb.
    expect(() => parseLog(['- 2026-08-22T09:14:03.221Z  Jane  Doe <j@e.com>  created'], 'f.md'))
      .toThrow(/bad verb "Doe <j@e\.com>  created"/);
  });

  it('accepts an unknown but well-formed verb, for forward compatibility', () => {
    const got = parseLog([`- 2026-08-22T09:14:03.221Z  ${AUTHOR}  reticulated: splines`], 'f.md');
    expect(got[0].verb).toBe('reticulated');
    expect(got[0].detail).toBe('splines');
  });
});

describe('renderLog round-trip', () => {
  it('round-trips every entry shape', () => {
    const entries: LogEntry[] = [
      entry(),
      entry({ verb: 'status', detail: 'open -> in-progress' }),
      entry({ verb: 'comment', text: 'line one\nline two' }),
      entry({ verb: 'comment', text: 'has\n\nblank line' }),
      entry({ verb: 'title', detail: 'old: with colon -> new' }),
    ];
    expect(parseLog(renderLog(entries).split('\n'), 'f.md')).toEqual(entries);
  });
});
