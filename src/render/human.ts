/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Issue } from '../core/types.js';
import type { Diagnosis, Repair } from '../store/doctor.js';
import type { LoadFailure } from '../store/issues.js';

// UUIDv7's leading 8 hex chars are only the top 32 bits of the 48-bit
// millisecond timestamp, so they stay constant for ~65 real seconds and
// collide for any two issues created in that window. 13 chars covers the
// full timestamp field (both dash-delimited groups), which is enough to
// distinguish issues created in different milliseconds.
const SHORT_ID_LEN = 13;

export function shortId(id: string): string {
  return id.slice(0, SHORT_ID_LEN);
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

export function renderIssueList(issues: Issue[]): string {
  if (issues.length === 0) return 'no issues\n';
  return `${issues
    .map((i) => `${shortId(i.id)}  ${pad(i.status, 11)}  ${pad(i.type, 7)}  ${i.title}`)
    .join('\n')}\n`;
}

export function renderIssueDetail(issue: Issue): string {
  const lines = [
    `${shortId(issue.id)}  ${issue.title}`,
    `  id         ${issue.id}`,
    `  type       ${issue.type}`,
    `  status     ${issue.status}${issue.resolution === null ? '' : ` (${issue.resolution})`}`,
    `  component  ${issue.component ?? '(none)'}`,
    `  assignee   ${issue.assignee ?? '(none)'}`,
    `  created    ${issue.created}`,
    `  creator    ${issue.creator}`,
  ];
  if (issue.body !== '') lines.push('', issue.body);
  if (issue.log.length > 0) {
    lines.push('', 'Log:');
    for (const e of issue.log) {
      const detail = e.detail === null ? '' : `: ${e.detail}`;
      lines.push(`  ${e.timestamp}  ${e.author}  ${e.verb}${detail}`);
      if (e.text !== null) for (const l of e.text.split('\n')) lines.push(`      ${l}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function renderWarnings(failures: LoadFailure[]): string {
  return failures
    .map((f) => {
      // parseIssue and readIssue are handed the path to build their messages
      // with, so a failure almost always names the file already; prefixing it
      // again produced "skipping x.md: x.md: ...". The fallback still applies
      // it for any message that does not, so the file is never lost.
      const detail = f.error.message.startsWith(f.file)
        ? f.error.message
        : `${f.file}: ${f.error.message}`;
      return `dz: warning: skipping ${detail}`;
    })
    .join('\n');
}

/**
 * What --fix changed, above the problems that remain. Printed even when
 * nothing is left to report: a command that silently rewrites files is worse
 * than a noisy one, and this is the only place dz writes without being asked
 * for a specific issue.
 */
export function renderRepairs(fixed: Repair[]): string {
  if (fixed.length === 0) return '';
  return `${fixed.map((f) => `fixed ${f.file}: ${f.message}\n`).join('')}\n`;
}

export function renderDiagnoses(problems: Diagnosis[]): string {
  if (problems.length === 0) return 'no problems found\n';
  const body = problems
    .map((p) => `${p.code}  ${p.message}\n  fix: ${p.remedy}\n`)
    .join('\n');
  const n = problems.length;
  return `${body}\n${n} problem${n === 1 ? '' : 's'} found\n`;
}
