/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { applyFilter, DzError, RESOLUTIONS, shortId } from 'ditz2';
import type { Issue, Project } from 'ditz2';
import { App, CLOSE_TOO_SHORT } from '../src/app.js';
import { initialState } from '../src/state.js';
import { footerOf, KEY, lines, mount, press, settle, stubProject } from './helpers.js';
import { three } from './fixtures.js';

/** alpha, as `close` leaves it. */
function closedIssue(): Issue {
  return { ...three()[0]!, status: 'closed', resolution: 'fixed' };
}

/**
 * A project whose `list` honours the filter it is handed, over a backlog in
 * which alpha is already closed.
 *
 * The other stubs here ignore their filter argument, which is fine when the
 * question is how many times the UI reloaded. It is not fine when the question
 * is *what the UI asked for*: a stub that returns the same issues either way
 * cannot tell a reload with SNAPSHOT_FILTER from one with the default, and the
 * check that the closed issue is still reachable would pass on both.
 */
function filteringProject(): Partial<Project> {
  const backlog = [closedIssue(), ...three().slice(1)];
  return {
    close: () => closedIssue(),
    list: (filter) => ({ issues: applyFilter(backlog, filter ?? {}), failures: [] }),
  };
}

describe('close', () => {
  it('opens on x and shows the issue it will close', async () => {
    // The overlay's own title, not the bare word "alpha": alpha is the
    // selected row of the list underneath, so `toContain('alpha')` says
    // nothing about whether anything opened at all.
    const alpha = three()[0]!;
    const { lastFrame, stdin } = mount();
    await press(stdin, 'x');
    expect(lastFrame()).toContain(`close ${shortId(alpha.id)}  ${alpha.title}`);
    expect(footerOf(lastFrame())).toContain('^S close');
  });

  it('does nothing on x when the list is empty', async () => {
    // The overlay renders the selected issue with a non-null assertion, so an
    // overlay that opened on nothing would not merely look odd — it would throw.
    const { lastFrame, stdin } = mount(undefined, { issues: [] });
    await press(stdin, 'x');
    expect(lastFrame()).not.toContain('^S close');
  });

  it('offers exactly the resolutions the facade accepts', async () => {
    // Imported, not retyped: RESOLUTIONS is the single source, and a literal
    // here could offer a value `close` would reject.
    const { lastFrame, stdin } = mount();
    await press(stdin, 'x');
    for (const r of RESOLUTIONS) expect(lastFrame()).toContain(r);
    // "Exactly" needs the count as well as the membership. Without it a
    // picker offering a fourth value the facade would reject still passes —
    // which is the drift this test is named for, in the direction that
    // reaches the operator as an INVALID_FIELD they did not ask for.
    const offered = lines(lastFrame()).filter((l) => /^\s*\([ *]\) /.test(l));
    expect(offered).toHaveLength(RESOLUTIONS.length);
  });

  it('moves between resolutions with the arrows and marks exactly one', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, 'x');
    expect(lastFrame()).toContain(`(*) ${RESOLUTIONS[0]}`);
    await press(stdin, KEY.down);
    expect(lastFrame()).toContain(`(*) ${RESOLUTIONS[1]}`);
    expect(lastFrame()).toContain(`( ) ${RESOLUTIONS[0]}`);
    const marked = lines(lastFrame()).filter((l) => l.includes('(*)'));
    expect(marked).toHaveLength(1);
  });

  it('stops at the ends rather than wrapping', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, 'x', KEY.up, KEY.up);
    expect(lastFrame()).toContain(`(*) ${RESOLUTIONS[0]}`);
    for (let i = 0; i < RESOLUTIONS.length + 2; i += 1) await press(stdin, KEY.down);
    expect(lastFrame()).toContain(`(*) ${RESOLUTIONS.at(-1)}`);
  });

  it('passes the chosen resolution and no comment when none was typed', async () => {
    const calls: [string, string, string | null | undefined][] = [];
    const { stdin } = mount({ close: (p, as, c) => { calls.push([p, as, c]); return closedIssue(); } });
    await press(stdin, 'x', KEY.down, KEY.ctrlS);
    expect(calls[0]![1]).toBe(RESOLUTIONS[1]);
    // null, not '' — the facade spells "no comment" as null everywhere else,
    // and an empty string would append a blank log entry.
    expect(calls[0]![2]).toBeNull();
  });

  it('passes a typed comment alongside the resolution', async () => {
    const calls: [string, string, string | null | undefined][] = [];
    const { stdin } = mount({ close: (p, as, c) => { calls.push([p, as, c]); return closedIssue(); } });
    await press(stdin, 'x', KEY.tab, 'd', 'o', 'n', 'e', KEY.ctrlS);
    expect(calls[0]![1]).toBe(RESOLUTIONS[0]);
    expect(calls[0]![2]).toBe('done');
  });

  it('tabs between the picker and the comment field', async () => {
    // Two fields need a way to move. Tab here is the same key plan 2c uses for
    // the form, so the habit transfers.
    const { lastFrame, stdin } = mount();
    await press(stdin, 'x', KEY.tab, 'd');
    // The cursor block is what says the letter landed in the entry rather than
    // anywhere else on the overlay.
    expect(lines(lastFrame()).join('\n')).toContain('d█');
    await press(stdin, KEY.tab, KEY.down);
    // Focus is back on the picker: the arrow moves it again...
    expect(lastFrame()).toContain(`(*) ${RESOLUTIONS[1]}`);
    // ...and the arrow was not also typed into the comment.
    expect(lines(lastFrame()).join('\n')).toContain('d█');
  });

  it('types into the comment field without moving the picker', async () => {
    // The bug this guards: while the comment field has focus, `d` is text —
    // not a jump to `duplicate`.
    //
    // The trailing arrow is here because the letters alone cannot fail. The
    // picker has no letter bindings to reach past, so `d` could only ever be
    // text; what can regress is up/down, which sits inside the focus check by
    // one line and would walk the resolution under the operator's typing if
    // it were lifted out of it.
    const { lastFrame, stdin } = mount();
    await press(stdin, 'x', KEY.tab, 'd', 'u', 'e', KEY.down);
    expect(lastFrame()).toContain('due');
    expect(lastFrame()).toContain(`(*) ${RESOLUTIONS[0]}`);
  });

  it('abandons on Esc without writing', async () => {
    const calls: unknown[] = [];
    const { lastFrame, stdin } = mount({ close: () => { calls.push(1); return closedIssue(); } });
    await press(stdin, 'x', KEY.escape);
    expect(calls).toHaveLength(0);
    expect(lastFrame()).not.toContain('^S close');
  });

  it('does not quit on q while open', async () => {
    // q is text in the comment field and must not reach the list's quit.
    const onExit = vi.fn();
    const { stdin } = mount(undefined, undefined, onExit);
    await press(stdin, 'x', KEY.tab, 'q');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('closes and reloads on success', async () => {
    let listCalls = 0;
    const { lastFrame, stdin } = mount({
      close: () => closedIssue(),
      list: () => { listCalls += 1; return { issues: three(), failures: [] }; },
    });
    await press(stdin, 'x', KEY.ctrlS);
    expect(listCalls).toBe(1);
    expect(lastFrame()).not.toContain('^S close');
  });

  it('keeps the closed issue reachable afterwards', async () => {
    // The reload uses SNAPSHOT_FILTER, so the issue just closed is still in
    // the snapshot and `all:true` can find it. Reloading with the default
    // filter would make it vanish with no way back — the single most likely
    // way to lose sight of your own work.
    const { lastFrame, stdin } = mount(filteringProject());
    await press(stdin, 'x', KEY.ctrlS);
    expect(lastFrame()).not.toContain('alpha');
    await press(stdin, '/', 'a', 'l', 'l', ':', 't', 'r', 'u', 'e', KEY.enter);
    expect(lastFrame()).toContain('alpha');
  });

  it('does not carry a comment draft into the close overlay', async () => {
    // Reachable with no Esc anywhere: a write that fails for a reason the
    // operator can fix leaves the text deliberately, and the error overlay
    // leaves the list interactive, so `c`, a refusal and then `x` all happen
    // on the same issue. Keying the draft to the issue alone cannot tell the
    // two overlays apart, and `x` `^S` — the ordinary "close as fixed, no
    // comment" gesture — would then attach an abandoned sentence to the log
    // where nobody can delete it.
    const calls: (string | null | undefined)[] = [];
    const { lastFrame, stdin } = mount({
      comment: () => { throw new DzError('INVALID_FIELD', 'no author identity: set DZ_AUTHOR'); },
      close: (p, as, c) => { calls.push(c); return closedIssue(); },
    });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS);
    expect(lastFrame()).toContain('no author identity');
    await press(stdin, 'x');
    expect(lines(lastFrame()).join('\n')).not.toContain('hi');
    await press(stdin, KEY.ctrlS);
    expect(calls).toEqual([null]);
  });

  it('does not carry a close comment into the next comment', async () => {
    // The same leak the other way round, and the same route to it: the close
    // was refused, the operator pressed `c` to say something instead, and the
    // sentence they had typed for the close is still sitting in the field.
    const calls: string[] = [];
    const { lastFrame, stdin } = mount({
      close: () => { throw new DzError('INVALID_FIELD', 'no author identity: set DZ_AUTHOR'); },
      comment: (p, t) => { calls.push(t); return three()[0]!; },
    });
    await press(stdin, 'x', KEY.tab, 'o', 'o', 'p', 's', KEY.ctrlS);
    expect(lastFrame()).toContain('no author identity');
    await press(stdin, 'c');
    expect(lines(lastFrame()).join('\n')).not.toContain('oops');
    // Not just blank on screen: the write must carry only what was typed for
    // it, since a leading "oops" would be indistinguishable from intent.
    await press(stdin, 'o', 'k', KEY.ctrlS);
    expect(calls).toEqual(['ok']);
  });

  it('brings the chosen resolution back with the text when a refused close reopens', async () => {
    // The draft comes back on reopen by design, and the resolution used not
    // to: `x`, down to wontfix, a reason, ^S, a refusal, `x` again put the
    // operator's own sentence back on screen over a picker silently reset to
    // `fixed`. Seeing your own words return is what says the form returned,
    // and the next ^S wrote a resolution nobody chose.
    const calls: string[] = [];
    const { lastFrame, stdin } = mount({
      close: (p, as) => {
        calls.push(as);
        if (calls.length === 1) {
          throw new DzError('INVALID_FIELD', 'no author identity: set DZ_AUTHOR');
        }
        return closedIssue();
      },
    });
    await press(stdin, 'x', KEY.down, KEY.tab, 'w', 'h', 'y', KEY.ctrlS);
    expect(calls).toEqual([RESOLUTIONS[1]]);
    expect(lastFrame()).toContain('no author identity');
    await press(stdin, 'x');
    // Both halves of the one form, asserted together: the text is what makes
    // the operator believe the form came back, so the picker has to agree.
    expect(lines(lastFrame()).join('\n')).toContain('why█');
    expect(lastFrame()).toContain(`(*) ${RESOLUTIONS[1]}`);
    await press(stdin, KEY.ctrlS);
    expect(calls).toEqual([RESOLUTIONS[1], RESOLUTIONS[1]]);
  });

  it('starts the resolution over when the form is a different one', async () => {
    // The other half of keying the resolution to `draftFor`: `x` on a second
    // issue is a new form and must not inherit the first one's `wontfix`, for
    // the same reason its comment must not be inherited either.
    const { lastFrame, stdin } = mount();
    await press(stdin, 'x', KEY.down, KEY.escape);
    await press(stdin, KEY.down, 'x');
    expect(lastFrame()).toContain(`(*) ${RESOLUTIONS[0]}`);
  });

  it('refuses to open in a terminal too short for the form, and says so', async () => {
    // The overlay has a floor of `CLOSE_OVERLAY_ROWS` and no way to draw
    // itself smaller, so below that App must decline rather than hand it a
    // budget it will overrun — an overlay taller than the frame makes Ink
    // scroll, and the display stops matching the state. Ten rows is a real
    // terminal of eleven, since index.tsx passes one row less than the
    // terminal has.
    const calls: unknown[] = [];
    const r = render(
      <App project={stubProject({ close: () => { calls.push(1); return closedIssue(); } })}
        initial={initialState(three(), [])} rows={10} width={80} onExit={vi.fn()} />,
    );
    await settle();
    await press(r.stdin, 'x');
    expect(r.lastFrame()).toContain(CLOSE_TOO_SHORT);
    expect(r.lastFrame()).not.toContain('^S close');
    // And ^S with no overlay open must not write, which is the whole point of
    // refusing rather than drawing a form the operator cannot see the end of.
    await press(r.stdin, KEY.ctrlS);
    expect(calls).toHaveLength(0);
    r.unmount();
  });

  it('advertises the keys it answers to, and no others', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, 'x');
    const footer = footerOf(lastFrame());
    expect(footer).toContain('tab field');
    expect(footer).toContain('up/down resolution');
    expect(footer).toContain('^S close');
    expect(footer).toContain('esc cancel');
    // Every one of these does nothing while the overlay is up.
    expect(footer).not.toContain('q quit');
    expect(footer).not.toContain('/ filter');
    expect(footer).not.toContain('r reload');
    expect(footer).not.toContain('? help');
  });
});
