/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { isIsoTimestamp } from './clock.js';
import { DzError } from './errors.js';
import { isUuid } from './id.js';
import { STATUSES } from './types.js';
import type { Config, Issue, Status } from './types.js';

/** Statuses `set --status` will accept. Closing needs a resolution, so it is excluded. */
export type SettableStatus = Exclude<Status, 'closed'>;

export function validateEnum<T extends string>(
  value: string, allowed: readonly T[], field: string,
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new DzError(
      'INVALID_FIELD',
      `"${value}" is not a valid ${field}, expected one of ${allowed.join(', ')}`,
    );
  }
  return value as T;
}

export function validateComponent(component: string | null, config: Config | null): void {
  if (component === null || config === null) return;
  if (!config.components.includes(component)) {
    const known = config.components.length === 0
      ? 'dz/config.yaml lists no components yet'
      : `dz/config.yaml lists ${config.components.join(', ')}`;
    throw new DzError(
      'INVALID_FIELD',
      `"${component}" is not a configured component; ${known}`,
    );
  }
}

export function assertSettableStatus(next: string): asserts next is SettableStatus {
  if (next === 'closed') {
    throw new DzError(
      'INVALID_FIELD',
      "cannot set status to 'closed' with 'set', because that would leave the resolution empty; " +
        'use `dz close <id> --as <fixed|wontfix|duplicate>` instead',
    );
  }
  validateEnum(next, STATUSES, 'status');
}

export function validateIssue(issue: Issue, config: Config | null): void {
  if (!isUuid(issue.id)) {
    throw new DzError('INVALID_FIELD', `issue id "${issue.id}" is not a valid uuid`);
  }
  // The published schema promises a non-empty title and RFC 3339 timestamps.
  // Nothing the CLI writes can violate either, but `dz edit` hands the file to
  // $EDITOR, and without these a hand edit saves cleanly and then makes
  // `dz show --json` emit output that fails the schema the tool publishes.
  if (issue.title.trim() === '') {
    throw new DzError('INVALID_FIELD', `issue ${issue.id} has an empty title`);
  }
  if (!isIsoTimestamp(issue.created)) {
    throw new DzError(
      'INVALID_FIELD',
      `issue ${issue.id} has created "${issue.created}", which is not an ISO 8601 timestamp`,
    );
  }
  for (const entry of issue.log) {
    if (!isIsoTimestamp(entry.timestamp)) {
      throw new DzError(
        'INVALID_FIELD',
        `issue ${issue.id} has a log entry timestamped "${entry.timestamp}", `
        + `which is not an ISO 8601 timestamp`,
      );
    }
  }
  if (issue.status === 'closed' && issue.resolution === null) {
    throw new DzError('INVALID_FIELD', `closed issue must have a resolution (${issue.id})`);
  }
  if (issue.status !== 'closed' && issue.resolution !== null) {
    throw new DzError(
      'INVALID_FIELD',
      `only a closed issue may have a resolution, but ${issue.id} is ${issue.status}`,
    );
  }
  validateComponent(issue.component, config);
}
