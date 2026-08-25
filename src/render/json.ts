/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { DzErrorCode } from '../core/errors.js';
import type { Issue } from '../core/types.js';
import type { Diagnosis } from '../store/doctor.js';
import type { LoadFailure } from '../store/issues.js';

export function renderIssuesJson(issues: Issue[]): string {
  return `${JSON.stringify(issues, null, 2)}\n`;
}

export function renderIssueJson(issue: Issue): string {
  return `${JSON.stringify(issue, null, 2)}\n`;
}

export function renderErrorJson(code: DzErrorCode | string, message: string): string {
  return `${JSON.stringify({ error: { code, message } })}\n`;
}

/**
 * Skipped files, for partial failure: `list` and `grep` still print their
 * results, so this is not an error envelope.
 *
 * One compact object on one line, like `renderErrorJson`, so the whole of
 * stderr in --json mode stays a single parseable object whichever of the two
 * it turns out to be. `code` is carried per file because the remedies differ:
 * CONFLICT_MARKERS means finish the merge, PARSE_ERROR means the file is
 * malformed. `message` keeps the filename it already contains, so the human
 * and machine forms do not diverge.
 */
export function renderWarningsJson(failures: LoadFailure[]): string {
  const warnings = failures.map((f) => ({
    file: f.file,
    code: f.error.code,
    message: f.error.message,
  }));
  return `${JSON.stringify({ warnings })}\n`;
}

/** `dz doctor` results. Its own stdout payload, not a warning envelope. */
export function renderDiagnosesJson(problems: Diagnosis[]): string {
  return `${JSON.stringify({ problems }, null, 2)}\n`;
}
