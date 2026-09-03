/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { DzError } from 'ditz2';
import { footerOf, KEY, lines, mount, press } from './helpers.js';
import { three } from './fixtures.js';

describe('comment', () => {
  it('opens on c and shows the issue it will comment on', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, 'c');
    expect(lastFrame()).toContain('alpha');
    expect(footerOf(lastFrame())).toContain('^S save');
  });

  it('does nothing on c when the list is empty', async () => {
    const { lastFrame, stdin } = mount(undefined, { issues: [] });
    await press(stdin, 'c');
    expect(lastFrame()).not.toContain('^S save');
  });

  it('takes typed text, including newlines, and shows it', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, 'c', 'i', 't', KEY.enter, 'i', 's');
    // Enter is a newline here, not save — otherwise a two-line comment is
    // impossible and the first line commits by accident.
    const shown = lines(lastFrame()).join('\n');
    expect(shown).toContain('it');
    expect(shown).toContain('is');
  });

  it('deletes across the line boundary on backspace', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, 'c', 'a', KEY.enter, KEY.backspace, 'b');
    expect(lines(lastFrame()).join('\n')).toContain('ab');
  });

  it('writes on Ctrl-S and passes exactly what was typed', async () => {
    const calls: [string, string][] = [];
    const { stdin } = mount({ comment: (p: string, t: string) => { calls.push([p, t]); return three()[0]!; } });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS);
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toBe('hi');
  });

  it('refuses to write an empty comment', async () => {
    // An empty log entry is noise that cannot be deleted afterwards.
    const calls: unknown[] = [];
    const { lastFrame, stdin } = mount({ comment: () => { calls.push(1); return three()[0]!; } });
    await press(stdin, 'c', KEY.ctrlS);
    expect(calls).toHaveLength(0);
    expect(lastFrame()).toContain('^S save');
  });

  it('abandons on Esc without writing', async () => {
    const calls: unknown[] = [];
    const { lastFrame, stdin } = mount({ comment: () => { calls.push(1); return three()[0]!; } });
    await press(stdin, 'c', 'h', 'i', KEY.escape);
    expect(calls).toHaveLength(0);
    expect(lastFrame()).not.toContain('^S save');
  });

  it('does not quit on q while the entry is open', async () => {
    const onExit = vi.fn();
    const { stdin } = mount(undefined, undefined, onExit);
    await press(stdin, 'c', 'q');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('closes and reloads on success', async () => {
    let listCalls = 0;
    const { lastFrame, stdin } = mount({
      comment: () => three()[0]!,
      list: () => { listCalls += 1; return { issues: three(), failures: [] }; },
    });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS);
    expect(listCalls).toBe(1);
    expect(lastFrame()).not.toContain('^S save');
  });

  it('shows what the facade refused, and keeps the text', async () => {
    // The operator has typed something. Throwing it away on a failure they
    // can fix — an unset DZ_AUTHOR — would be the worst moment to lose it.
    const { lastFrame, stdin } = mount({
      comment: () => { throw new DzError('INVALID_FIELD', 'no author identity: set DZ_AUTHOR'); },
    });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS);
    expect(lastFrame()).toContain('no author identity');
    // The text is only really "kept" if the operator can get back to it. c
    // reopens the entry for the same issue, and it must still say hi rather
    // than starting over from a blank line.
    await press(stdin, 'c');
    expect(lines(lastFrame()).join('\n')).toContain('hi');
  });

  it('dismisses the error on Esc, leaving the list usable', async () => {
    const onExit = vi.fn();
    const { lastFrame, stdin } = mount({
      comment: () => { throw new DzError('INVALID_FIELD', 'no author identity: set DZ_AUTHOR'); },
    }, undefined, onExit);
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS);
    expect(lastFrame()).toContain('no author identity');
    const footer = footerOf(lastFrame());
    expect(footer).toContain('esc dismiss');
    // ERROR_KEYS is LIST_KEYS with `esc dismiss` prefixed, and the point of
    // composing rather than hand-copying is that the list's own bindings keep
    // being advertised while the message is up — the list underneath is still
    // fully interactive, which is what the rest of this test then exercises.
    // Without these, replacing the composition with a literal that dropped
    // half the bindings would fail nothing in the suite.
    expect(footer).toContain('q quit');
    expect(footer).toContain('c comment');
    expect(footer).toContain('x close');
    await press(stdin, KEY.escape);
    expect(lastFrame()).not.toContain('no author identity');
    // Not just gone from the screen — the list underneath was never disabled.
    await press(stdin, 'j');
    expect(lines(lastFrame()).find((l) => l.startsWith('>'))).toContain('beta');
    await press(stdin, 'q');
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('does not carry the error footer onto the issue screen', async () => {
    // The error overlay never clears when Enter opens the issue view, so the
    // footer and the Esc handler must agree on the same screen check or the
    // footer can end up naming keys that mean something else here: esc would
    // still say "dismiss" while it actually closes the issue.
    const { lastFrame, stdin } = mount({
      comment: () => { throw new DzError('INVALID_FIELD', 'no author identity: set DZ_AUTHOR'); },
    });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS);
    expect(lastFrame()).toContain('no author identity');
    await press(stdin, KEY.enter);
    const footer = footerOf(lastFrame());
    expect(footer).toContain('q back');
    expect(footer).not.toContain('esc dismiss');
    expect(footer).not.toContain('/ filter');
    expect(footer).not.toContain('r reload');
  });

  it('does not carry a draft onto a different issue', async () => {
    // The error overlay leaves the list interactive, so the selection can
    // move to a different issue before the operator reopens the entry — and
    // the draft must not follow it there.
    const { lastFrame, stdin } = mount({
      comment: () => { throw new DzError('INVALID_FIELD', 'no author identity: set DZ_AUTHOR'); },
    });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS);
    expect(lastFrame()).toContain('no author identity');
    await press(stdin, 'j', 'c');
    expect(lastFrame()).toContain('beta');
    expect(lines(lastFrame()).join('\n')).not.toContain('hi');
  });

  it('lets a later refresh failure replace a stale write-failure message', async () => {
    // The error overlay must not have absolute precedence over the status
    // line forever: a fresh refresh's own outcome has to be seen too, or an
    // old write failure would sit there hiding whatever happens next.
    const { lastFrame, stdin } = mount({
      comment: () => { throw new DzError('INVALID_FIELD', 'no author identity: set DZ_AUTHOR'); },
      list: () => { throw new Error('disk on fire'); },
    });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS);
    expect(lastFrame()).toContain('no author identity');
    await press(stdin, 'r');
    expect(lastFrame()).toContain('disk on fire');
    expect(lastFrame()).not.toContain('no author identity');
  });
});
