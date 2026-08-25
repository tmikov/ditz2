/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { DzError } from './errors.js';
import type { LogEntry } from './types.js';

const SEP = '  ';
const INDENT = '    ';

/**
 * Shape only, deliberately not a closed vocabulary: a newer version may log a
 * verb this one has never heard of, and must still round-trip the file. What
 * the shape does catch is a field that drifted across a separator — an author
 * containing a double space silently shifts its tail into the verb.
 */
const VERB_RE = /^[a-z]+$/;

function parseEntryHeader(rest: string, filename: string): LogEntry {
  const i1 = rest.indexOf(SEP);
  if (i1 === -1) {
    throw new DzError('PARSE_ERROR', `${filename}: malformed log entry, no author: ${rest}`);
  }
  const timestamp = rest.slice(0, i1);
  const afterTs = rest.slice(i1 + SEP.length);

  const i2 = afterTs.indexOf(SEP);
  if (i2 === -1) {
    throw new DzError('PARSE_ERROR', `${filename}: malformed log entry, no verb: ${rest}`);
  }
  const author = afterTs.slice(0, i2);
  const afterAuthor = afterTs.slice(i2 + SEP.length);

  const colon = afterAuthor.indexOf(': ');
  const verb = colon === -1 ? afterAuthor : afterAuthor.slice(0, colon);
  const detail = colon === -1 ? null : afterAuthor.slice(colon + 2);

  if (!VERB_RE.test(verb)) {
    throw new DzError('PARSE_ERROR', `${filename}: malformed log entry, bad verb "${verb}": ${rest}`);
  }

  return { timestamp, author, verb, detail, text: null };
}

export function parseLog(lines: string[], filename: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of lines) {
    if (line.startsWith('- ')) {
      entries.push(parseEntryHeader(line.slice(2), filename));
      continue;
    }
    // Checked before the blank-line case: a line of exactly four spaces is a
    // blank line *inside* a comment, not a separator between entries.
    if (line.startsWith(INDENT)) {
      const current = entries[entries.length - 1];
      if (current === undefined) {
        throw new DzError('PARSE_ERROR', `${filename}: continuation line before any log entry`);
      }
      const piece = line.slice(INDENT.length);
      current.text = current.text === null ? piece : `${current.text}\n${piece}`;
      continue;
    }
    if (line.trim() === '') continue;
    throw new DzError('PARSE_ERROR', `${filename}: unrecognized log line: ${line}`);
  }
  return entries;
}

export function renderLog(entries: LogEntry[]): string {
  let out = '';
  for (const e of entries) {
    const detail = e.detail === null ? '' : `: ${e.detail}`;
    out += `- ${e.timestamp}${SEP}${e.author}${SEP}${e.verb}${detail}\n`;
    if (e.text !== null) {
      for (const line of e.text.split('\n')) out += `${INDENT}${line}\n`;
    }
  }
  return out;
}
