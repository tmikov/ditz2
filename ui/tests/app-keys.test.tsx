/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { DzError } from 'ditz2';
import { App, CLOSE_TOO_SHORT, ERROR_KEYS, FORM_TOO_SHORT, LIST_KEYS } from '../src/app.js';
import { FOOTER_ROWS } from '../src/components/Chrome.js';
import { initialState, reducer } from '../src/state.js';
import type { LockInfo, Project } from 'ditz2';
import { footerOf, KEY, lines, press, settle } from './helpers.js';
import { issue, three } from './fixtures.js';

/** The terminal every mount below is given. Named so an assertion can share it. */
const WIDTH = 80;

/** A Project that fails loudly if the UI calls anything it should not. */
function stubProject(over: Partial<Project> = {}): Project {
  const reject = (): never => { throw new Error('unexpected project call'); };
  return {
    root: '/tmp/demo',
    name: 'demo',
    whoami: () => 'Jane Roe <jane@example.com>',
    list: () => ({ issues: three(), failures: [] }),
    show: reject, grep: reject, add: reject, set: reject,
    comment: reject, close: reject, doctor: reject,
    readForEdit: reject, parseEdit: reject, saveEdited: reject,
    // The fixture's own two components, so that no issue in `three()` holds
    // one the config does not list and the form's height is predictable.
    // A default that answers is safe here because nothing else calls it —
    // but note that plan 2b's filter test passed for free against a default
    // `list` that ignored its argument, so any test about *which* components
    // are offered must pass its own.
    components: { list: () => ['cli', 'store'], add: reject, remove: reject },
    lock: { state: reject, break: reject },
    ...over,
  } as Project;
}

/**
 * Twenty rows, because App declines to open the *form* below seventeen and
 * the footer sweep below now has a form case in it.
 *
 * The same trap, one overlay later. It was ten while `x` was the tallest
 * thing here, and the sweep was measuring the list footer under a close
 * overlay that never opened; raising it to fourteen fixed that, and at
 * fourteen the sweep would measure the list footer under a *form* that never
 * opened. Twenty is three rows above the form's refusal boundary rather than
 * one, so the next overlay to grow fails the marker assertion here instead of
 * quietly measuring the wrong screen.
 */
const ROWS = 20;

function mount(over: Partial<Project> = {}, onExit = vi.fn()) {
  const r = render(
    <App
      project={stubProject(over)}
      initial={initialState(three(), [])}
      rows={ROWS}
      width={WIDTH}
      onExit={onExit}
    />,
  );
  return { ...r, onExit };
}

/** The row the cursor is on, or undefined. */
function marked(frame: string | undefined): string | undefined {
  return lines(frame).find((l) => l.startsWith('>'));
}

/**
 * The lock holder the waiting overlay names, and the two refusals that reach
 * it. Module scope because both sweeps below drive the same screens: the
 * footer-width one and the frame-height one would otherwise each carry their
 * own copy of a fixture that has to describe the same lock.
 */
const HOLDER: LockInfo = {
  version: 1,
  token: '0f2c4e1a-0000-4000-8000-000000000001',
  pid: 4821,
  hostname: 'build-42',
  created: '2026-08-30T09:00:00Z',
  command: 'dz close',
};
const locked = (): never => { throw new DzError('LOCKED', 'locked'); };
const refused = (): never => { throw new DzError('INVALID_FIELD', 'no author identity'); };
const held: Partial<Project> = {
  lock: { state: () => ({ kind: 'active', info: HOLDER }), break: () => false },
};

describe('navigation', () => {
  it('starts on the first issue', async () => {
    const { lastFrame } = mount();
    await settle();
    expect(marked(lastFrame())).toContain('alpha');
  });

  it('moves with the arrow keys', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.down);
    expect(marked(lastFrame())).toContain('beta');
    await press(stdin, KEY.up);
    expect(marked(lastFrame())).toContain('alpha');
  });

  it('moves with j and k as well', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, 'j', 'j');
    expect(marked(lastFrame())).toContain('gamma');
    await press(stdin, 'k');
    expect(marked(lastFrame())).toContain('beta');
  });

  it('jumps to the ends with G and g', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, 'G');
    expect(marked(lastFrame())).toContain('gamma');
    await press(stdin, 'g');
    expect(marked(lastFrame())).toContain('alpha');
  });

  it('jumps to the ends with End and Home', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.end);
    expect(marked(lastFrame())).toContain('gamma');
    await press(stdin, KEY.home);
    expect(marked(lastFrame())).toContain('alpha');
  });

  it('pages with PgDn and Ctrl-D', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.pageDown);
    expect(marked(lastFrame())).toContain('gamma');
    await press(stdin, KEY.pageUp);
    expect(marked(lastFrame())).toContain('alpha');
    await press(stdin, KEY.ctrlD);
    expect(marked(lastFrame())).toContain('gamma');
    await press(stdin, KEY.ctrlU);
    expect(marked(lastFrame())).toContain('alpha');
  });

  it('pages by exactly one screen, not to the end', async () => {
    // The three-issue fixture cannot show this. With rows=20 any delta of 2 or
    // more clamps to the last row, so a page of 10, a page of 999 and a jump
    // to the end are indistinguishable. Paging needs a list longer than a page
    // before the magnitude means anything.
    //
    // rows=22 rather than 10: the page is the list's own share of the screen
    // (listRows), not the whole screen budget, so the fixture has to make that
    // share land on a round number.
    // floor((22 - CHROME_ROWS - DETAIL_BORDER_ROWS) * 0.6) = floor(17 * 0.6)
    // = 10, which is what the assertions below pin — issue 10, then issue 20,
    // back to issue 10.
    //
    // It was 21 while CHROME_ROWS was 3. The footer's second line took a row,
    // so 21 now pages by 9 and the round number moved up with the chrome
    // rather than the expectations moving off it.
    const many = Array.from({ length: 30 }, (_, n) => issue({
      id: `01a00000-${String(n).padStart(4, '0')}-7000-8000-000000000000`,
      title: `issue ${n}`,
    }));
    const { lastFrame, stdin } = render(
      <App project={stubProject()} initial={initialState(many, [])}
        rows={22} width={80} onExit={vi.fn()} />,
    );
    await settle();
    expect(marked(lastFrame())).toContain('issue 0');
    await press(stdin, KEY.pageDown);
    expect(marked(lastFrame())).toContain('issue 10');
    await press(stdin, KEY.pageDown);
    expect(marked(lastFrame())).toContain('issue 20');
    await press(stdin, KEY.pageUp);
    expect(marked(lastFrame())).toContain('issue 10');
  });

  it('stops at the ends instead of wrapping', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.up, KEY.up);
    expect(marked(lastFrame())).toContain('alpha');
    await press(stdin, 'G', KEY.down, KEY.down);
    expect(marked(lastFrame())).toContain('gamma');
  });
});

describe('chrome', () => {
  it('names the project and counts what is shown', async () => {
    const { lastFrame } = mount();
    await settle();
    expect(lastFrame()).toContain('demo');
    expect(lastFrame()).toContain('3 of 3');
  });

  /**
   * A screen the sweep below can reach, and how to tell it apart.
   *
   * `marker` is a substring the named screen shows and the plain list does
   * not, and it is what keeps the sweep from going vacuous — not a
   * hypothetical worry: the sweep this replaces pressed no keys at all, so it
   * measured the list screen three times over and never once measured an
   * overlay. `the list` is the only entry with no marker, being the screen
   * everything else is distinguished from.
   *
   * `refusal` is for the one screen App can decline to open. Below `minRows`
   * the close form cannot fit, so what the sweep must find there is the
   * message saying so — asserting the overlay's own marker at every height
   * would just make the sweep fail once the refusal works.
   *
   * Separate from `footer width`'s table below on purpose: that one is about
   * the last line and every marker in it is a footer substring, whereas the
   * help overlay and the filter field are named here by what they draw in the
   * body and above the footer respectively.
   */
  interface Screen {
    name: string;
    over: Partial<Project>;
    keys: string[];
    marker: string | null;
    minRows?: number;
    refusal?: string;
  }

  const SCREENS: Screen[] = [
    { name: 'the list', over: {}, keys: [], marker: null },
    { name: 'the issue view', over: {}, keys: [KEY.enter], marker: 'enter/esc back' },
    { name: 'the help overlay', over: {}, keys: ['?'], marker: 'up/down to scroll' },
    { name: 'the filter field', over: {}, keys: ['/', 'i'], marker: '/i█' },
    { name: 'the comment overlay', over: {}, keys: ['c'], marker: '^S save' },
    {
      name: 'the close overlay',
      over: {},
      keys: ['x'],
      marker: '^S close',
      // Not derived: App keeps CHROME_ROWS and the detail border back before
      // the overlay sees a budget, and neither number is exported. Thirteen is
      // the observed *refusal* boundary — thirteen rows of App budget, which
      // `index.tsx` reaches from a fourteen-row terminal — and it cannot go
      // stale quietly: if the chrome grows again, rows=13 refuses and the
      // marker assertion fails here rather than the frame silently
      // overflowing.
      //
      // It was 12 while CHROME_ROWS was 3; the footer's second line moved it,
      // and the row it moved by is a chrome row, not a change to the overlay.
      //
      // It sits one row above the boundary the overflow actually has, on
      // purpose. `x` compares CLOSE_OVERLAY_ROWS against the LIST screen's
      // budget, which reserves the detail pane's border row that no overlay
      // draws, so it declines at rows=12 where the form does fit. The height
      // assertion below would pass either way there, so the refusal marker is
      // the only thing holding this case: relaxing the guard to the overlay's
      // own budget has to be done here too, deliberately.
      minRows: 13,
      refusal: CLOSE_TOO_SHORT,
    },
    {
      name: 'the form',
      over: {},
      keys: [KEY.tab],
      marker: 'up/down pick',
      // Counted in App's `rows` prop and not in terminal rows: App keeps five
      // back on the list screen — two chrome rows, the two-line footer and
      // <Detail>'s border — and the form needs twelve over this stub's two
      // components, for five fields plus its tallest picker plus four rows of
      // its own chrome. Observed, like the close overlay's thirteen, and it
      // fails loudly rather than going stale: if the form or the chrome grows,
      // rows=17 refuses and this marker assertion is what says so.
      //
      // Twelve, not the fourteen a four-component project needs: `formRows`
      // takes the *configured* list, so the floor is a property of the
      // project as much as of the layout.
      minRows: 17,
      refusal: FORM_TOO_SHORT,
    },
    {
      name: 'the new-issue form',
      over: {},
      keys: ['n'],
      // The heading, not the footer: `n` and `tab` draw the same FORM_KEYS, so
      // `up/down pick` would not tell this case apart from the one above — and
      // telling them apart is the whole point of the entry.
      marker: 'new issue',
      // Two rows below the edit form's seventeen, and that gap is the reason
      // this is a separate entry rather than a second key sequence on the one
      // above. `formRows` counts the fields it will draw: `add` has three and
      // `set` has five, so the same project needs 10 rows for one form and 12
      // for the other, and App reaches those from rows=15 and rows=17. Between
      // them is a terminal where `n` works and `tab` says the terminal is too
      // short.
      //
      // What the sweep pins there is the pair of markers — `new issue` for
      // `n`, FORM_TOO_SHORT for `tab` — and a frame no taller than the budget.
      // The height figure below is ILLUSTRATIVE and no assertion holds it:
      // measured at rows=15 and 16 with no notice showing, the add form drew a
      // 10-line frame, which `toBeLessThanOrEqual(rows)` would accept anywhere
      // from 1 to 15. Read it as why the form fits, not as a checked fact.
      minRows: 15,
      refusal: FORM_TOO_SHORT,
    },
    {
      name: 'the waiting overlay',
      over: { comment: locked, ...held },
      keys: ['c', 'h', KEY.ctrlS],
      marker: 'r retry',
    },
    {
      name: 'a write failure',
      over: { comment: refused },
      keys: ['c', 'h', KEY.ctrlS],
      marker: 'esc dismiss',
    },
  ];

  // Nine and eleven are the two that matter and neither was swept. Every
  // number here is a `rows` budget and not a terminal height: `index.tsx`
  // hands App the terminal height minus one, so the terminal that produces an
  // entry below is always one row taller than it. The close overlay cannot
  // render in fewer than eight rows however small the budget gets
  // (`CLOSE_OVERLAY_ROWS`, three resolutions plus five), and the frame around
  // it draws 11 lines, 12 with a notice. **Re-measured after the footer gained
  // its second line**, by dispatching `openClose` into the initial state so
  // that the `x` guard is bypassed: it now overflows from rows=10 downwards in
  // BOTH cases, and fits from rows=11 up only with no notice showing —
  // rows=11 with one still overflows. It used to fit from rows=11 either way.
  // The refusal is above both, at rows=13, for the reason `minRows` gives;
  // 12 and 13 are here so the close overlay's boundary is swept from both
  // sides.
  //
  // 16 and 17 are the edit form's, and the pair is the point. A boundary is
  // only pinned by the two heights that straddle it: an entry at 17 alone says
  // the form opens at 17, which stays true if the real floor slips to 16, and
  // the nearest value below used to be 13, where the form refuses either way.
  // So the whole file would have passed with the floor a row out and the
  // comment here claiming otherwise. 16 is what makes the claim true.
  //
  // 14 and 15 are the new-issue form's, added for exactly the same reason and
  // against exactly the same near-miss: its floor is two rows lower than the
  // edit form's, so before these two the sweep straddled it with 13 and 16 —
  // four rows apart — and the add form's real boundary could have moved a row
  // either way without a single assertion noticing.
  const HEIGHTS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 23];

  for (const { name, over, keys, marker, minRows, refusal } of SCREENS) {
    it(`never draws a frame taller than the row budget it was given, on ${name}`, async () => {
      // The one check that was missing: every other test asserts on frame
      // *content*. <Detail>'s top border is a chrome row no component returns,
      // so it went unbudgeted and the frame reached exactly the terminal height
      // whenever the status line was showing — at which point Ink clears the
      // whole screen on every render and the UI flickers per keystroke.
      const many = Array.from({ length: 30 }, (_, n) => issue({
        id: `01a00000-${String(n).padStart(4, '0')}-7000-8000-000000000000`,
        title: `issue ${n}`,
      }));
      for (const rows of HEIGHTS) {
        for (const notice of [null, 'something happened']) {
          const state = notice === null
            ? initialState(many, [])
            : reducer(initialState(many, []), { type: 'notice', text: notice });
          // Unmounted in a finally: the waiting overlay runs a one-second
          // interval that outlives the test otherwise.
          const r = render(
            <App project={stubProject(over)} initial={state}
              rows={rows} width={80} onExit={vi.fn()} />,
          );
          try {
            await settle();
            await press(r.stdin, ...keys);
            const where = `${name} at rows=${rows}, notice=${notice !== null}`;
            const frame = lines(r.lastFrame()).join('\n');
            const want = minRows !== undefined && rows < minRows ? refusal! : marker;
            if (want !== null) expect(frame, where).toContain(want);
            expect((r.lastFrame() ?? '').split('\n').length, where).toBeLessThanOrEqual(rows);
          } finally {
            r.unmount();
          }
        }
      }
    });
  }

  it('advertises the bindings that work, and only those', async () => {
    const { lastFrame } = mount();
    await settle();
    const footer = footerOf(lastFrame());
    expect(footer).toContain('q quit');
    // Plan 2b made `c` and `x` work, so the rule that once kept them out now
    // requires them: a working binding the footer omits is as much a lie as a
    // dead one it lists, and `x` is destructive enough that `?` alone is not
    // a fair place to hide it.
    //
    // Un-zipped, now that a second footer line has room for both spelled out.
    // Two assertions are as strong as the one zipped string was: a footer
    // naming `c` and forgetting `x` fails the second.
    expect(footer).toContain('c comment');
    expect(footer).toContain('x close');
    // `tab` works now, so the footer owes it, and the footer is two lines:
    // `footerOf` joins them, so it does not matter which line it lands on —
    // only that it is not missing.
    expect(footer).toContain('tab edit');
    // `n` works now, so the footer owes it — the flip this assertion was
    // written to force. It was the negative `not.toContain('n new')` for
    // exactly as long as the key was dead, which is the half of the rule the
    // task binding a key is uniquely placed to break: a working binding the
    // footer omits is as much a lie as a dead one it lists.
    expect(footer).toContain('n new');
    // Enter is still the reader, in both directions. This is the forward
    // guard plan 2b left here; it stays because Enter must never become edit.
    expect(footer).not.toContain('enter edit');
  });

  it('warns about unreadable files rather than showing a short list quietly', async () => {
    const failures = [{ file: 'dz/issues/broken.md', error: new Error('bad') as never }];
    const { lastFrame } = render(
      <App project={stubProject()} initial={initialState(three(), failures)}
        rows={10} width={80} onExit={vi.fn()} />,
    );
    await settle();
    expect(lastFrame()).toContain('1 unreadable');
  });
});

/**
 * Every screen that draws a <Footer>, in a terminal of the advertised width.
 *
 * Not literally every screen: the filter field replaces the footer rather than
 * filling it, and what it draws is the operator's own query, which has no
 * fixed length to overflow and is meant to clip once it is long enough. These
 * seven are the ones whose last line is a fixed list of key bindings.
 *
 * `truncate` appends '…' exactly when a string did not fit, so a footer ending
 * in one is a binding the operator is being shown and cannot read. `ERROR_KEYS`
 * shipped at 82 characters against this 80-column fixture and rendered
 * `… q q…`; nothing caught it, because every other footer assertion here is
 * about content and passes just as happily on a clipped line.
 *
 * Derived footers are why this is a sweep rather than one check: `ERROR_KEYS`
 * is built from `LIST_KEYS`, so a label added to the list overflows a screen
 * whose own string nobody edited.
 */
describe('footer width', () => {
  /**
   * `[name, project, keys, marker]`, where `marker` is a substring only the
   * named screen's footer has.
   *
   * Without it a case whose key sequence stopped opening its overlay would
   * measure the list footer and pass — six of the seven would have gone
   * quietly vacuous, including the write failure, which was the one carrying
   * all the risk at exactly 80 of 80 columns before the footer gained its
   * second line. It is 61 now, and the widest of the seven is the issue view
   * at 62; neither is near the ceiling and the marker still has to be
   * checked, because a vacuous case is vacuous whatever it measures.
   * `the list` is the single case whose
   * marker is not unique, since `ERROR_KEYS` prefixes `LIST_KEYS`; it presses
   * no keys at all, and the error footer is pinned by its own marker below.
   */
  const screens: [string, Partial<Project>, string[], string][] = [
    ['the list', {}, [], 'q quit'],
    ['the issue view', {}, [KEY.enter], 'enter/esc back'],
    ['the comment overlay', {}, ['c'], '^S save'],
    ['the close overlay', {}, ['x'], '^S close'],
    ['the form', {}, [KEY.tab], 'up/down pick'],
    ['the waiting overlay', { comment: locked, ...held }, ['c', 'h', KEY.ctrlS], 'r retry'],
    ['a write failure', { comment: refused }, ['c', 'h', KEY.ctrlS], 'esc dismiss'],
  ];

  for (const [name, over, keys, marker] of screens) {
    it(`is readable to the end on ${name}`, async () => {
      // Unmounted in a finally: the waiting overlay runs a one-second interval
      // that outlives the test otherwise.
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
  }

  /**
   * The columns every footer line must still have free once the keys already
   * announced for it have landed.
   *
   * One number for both lines rather than two tuned ones. It is not a bound on
   * any particular key: it is the standing claim that the footer is never
   * within a keystroke of the ceiling, which is the thing the two-line rework
   * exists to buy and the thing that was silently spent twice before it.
   */
  const SPARE = 8;

  it('leaves room on the second line for the key plan 2d has not added yet', () => {
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
    expect(projected.length).toBeLessThanOrEqual(WIDTH - SPARE);
  });

  it('leaves room on the composed line, which is the error footer', () => {
    // The gap the second line's projection left open. Moving a binding up to
    // LIST_KEYS[0] takes ERROR_KEYS[0] with it — it is `esc dismiss  ` plus
    // that line — and putting plan 2c's two keys there reaches 78 of 80 while
    // every other check in this file stays green: the sweep above only refuses
    // a line that has already been clipped, and the projection only watches
    // the second line. So the first line grew unwatched, which is precisely
    // the failure the two-line footer was built to end.
    //
    // Asserted on ERROR_KEYS and not on LIST_KEYS[0]: the error footer is the
    // longer of the two and therefore the one that hits the ceiling first, so
    // a bound on the list line alone would permit an error line of 85.
    // Imported rather than reassembled here, for the reason its own comment
    // in app.tsx gives.
    //
    // **Composed, not widest.** Measured: ISSUE_KEYS[0] is 62 columns and
    // ERROR_KEYS[0] is 61, so this is not the longest footer line in the
    // project and an earlier version of this test's name said it was. The
    // subject is right and only the name was wrong: ISSUE_KEYS is a literal
    // that changes only when somebody edits it, while this line is derived
    // from LIST_KEYS[0] and grows on its own every time the list gains a
    // binding. That is the growth a margin buys headroom for. Every footer,
    // ISSUE_KEYS included, is covered against real clipping by the width
    // sweep above.
    //
    // No projection appended, unlike the second line: nothing is announced for
    // this line, so what is claimed is only that it has SPARE columns free as
    // it stands. Same number, same meaning; different subject, because one
    // line has a known future key and the other does not.
    expect(ERROR_KEYS[0]!.length).toBeLessThanOrEqual(WIDTH);
    expect(ERROR_KEYS[0]!.length).toBeLessThanOrEqual(WIDTH - SPARE);
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
});

describe('quitting', () => {
  it('calls onExit for q', async () => {
    const { stdin, onExit } = mount();
    await press(stdin, 'q');
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
