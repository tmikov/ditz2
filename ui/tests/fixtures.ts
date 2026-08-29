/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Issue } from 'ditz2';

/**
 * An Issue literal. Reducer and rendering tests are about issue data, not about
 * files, so they build issues directly rather than through a project on disk.
 * The end-to-end test in Task 10 is what covers real files.
 */
export function issue(over: Partial<Issue> & { id: string; title: string }): Issue {
  return {
    type: 'task',
    status: 'open',
    resolution: null,
    component: null,
    assignee: null,
    created: '2026-08-26 09:00',
    creator: 'Test User <test@example.com>',
    body: '',
    log: [],
    unknown: {},
    ...over,
  };
}

/** Three open issues with distinguishable ids, in list order. */
export function three(): Issue[] {
  return [
    issue({ id: '01a00000-0001-7000-8000-000000000001', title: 'alpha', type: 'bug', component: 'cli' }),
    issue({ id: '01a00000-0002-7000-8000-000000000002', title: 'beta', type: 'feature', component: 'store' }),
    issue({ id: '01a00000-0003-7000-8000-000000000003', title: 'gamma', status: 'in-progress' }),
  ];
}
