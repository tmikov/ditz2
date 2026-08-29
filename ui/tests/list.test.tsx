/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { IssueList } from '../src/components/IssueList.js';
import { lines, settle } from './helpers.js';
import { three } from './fixtures.js';

describe('<IssueList>', () => {
  it('draws one row per issue, in order', async () => {
    const issues = three();
    const { lastFrame } = render(
      <IssueList issues={issues} selectedId={issues[1]!.id} rows={10} width={80} />,
    );
    await settle();
    const body = lines(lastFrame()).filter((l) => l !== '');
    expect(body).toHaveLength(3);
    expect(body[0]).toContain('alpha');
    expect(body[2]).toContain('gamma');
  });

  it('marks exactly one row', async () => {
    const issues = three();
    const { lastFrame } = render(
      <IssueList issues={issues} selectedId={issues[1]!.id} rows={10} width={80} />,
    );
    await settle();
    const marked = lines(lastFrame()).filter((l) => l.startsWith('>'));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('beta');
  });

  it('says so rather than drawing nothing when the list is empty', async () => {
    const { lastFrame } = render(
      <IssueList issues={[]} selectedId={null} rows={10} width={80} />,
    );
    await settle();
    expect(lastFrame()).toContain('no issues');
  });

  it('marks the selected row inside a scrolled window', async () => {
    // The window starts at 36, so the selected issue's absolute index (40) is
    // nothing like its position in the slice (4). Marking by slice position
    // marks nothing at all here.
    const many = Array.from({ length: 50 }, (_, n) => ({
      ...three()[0]!,
      id: `01a00000-${String(n).padStart(4, '0')}-7000-8000-000000000000`,
      title: `issue ${n}`,
    }));
    const { lastFrame } = render(
      <IssueList issues={many} selectedId={many[40]!.id} rows={5} width={80} />,
    );
    await settle();
    const marked = lines(lastFrame()).filter((l) => l.startsWith('>'));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('issue 40');
  });

  it('keeps the mark on the issue when the list reorders', async () => {
    // Guards the component's *interface*, not its arithmetic. Marking by
    // `from + n === selected` is algebraically identical to marking by id here
    // (`selected` is an id lookup into the same array), so no fixture can
    // separate those two. What this does catch is a change of contract: an
    // IssueList that took a caller-computed `selectedIndex` prop instead of
    // `selectedId` would mark the wrong row as soon as the order changed, and
    // "selection follows the issue, never the position" is a global constraint
    // of this plan.
    const issues = three();
    const target = issues[2]!;
    const { lastFrame } = render(
      <IssueList issues={[...issues].reverse()} selectedId={target.id} rows={10} width={80} />,
    );
    await settle();
    const marked = lines(lastFrame()).filter((l) => l.startsWith('>'));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain(target.title);
  });

  it('keeps a wide title on a single row instead of wrapping it', async () => {
    // A wrapped row pushes every row below it out of place, so rowFor must
    // truncate here — unlike the detail and issue panes, which reflow.
    const wide = { ...three()[0]!, title: 'x'.repeat(500) };
    const { lastFrame } = render(
      <IssueList issues={[wide]} selectedId={wide.id} rows={10} width={60} />,
    );
    await settle();
    const body = lines(lastFrame()).filter((l) => l !== '');
    expect(body).toHaveLength(1);
  });

  it('shows only a window of a long list, containing the selection', async () => {
    const many = Array.from({ length: 50 }, (_, n) => ({
      ...three()[0]!,
      id: `01a00000-${String(n).padStart(4, '0')}-7000-8000-000000000000`,
      title: `issue ${n}`,
    }));
    const { lastFrame } = render(
      <IssueList issues={many} selectedId={many[40]!.id} rows={5} width={80} />,
    );
    await settle();
    const body = lines(lastFrame()).filter((l) => l !== '');
    expect(body).toHaveLength(5);
    expect(lastFrame()).toContain('issue 40');
    expect(lastFrame()).not.toContain('issue 0\n');
  });
});
