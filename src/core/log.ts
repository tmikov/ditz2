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
  // A blank line is ambiguous: inside a comment it is content, after one it is
  // separation from the next entry. Which it is depends on what comes *after*
  // it, so blank lines are counted and only become text when continuation
  // resumes. Whatever is still pending at a new entry, or at the end, was
  // separation. This is what lets a blank line be written blank; the format
  // used to spell it as four spaces purely because this loop could not wait.
  let pending = 0;
  for (const line of lines) {
    if (line.startsWith('- ')) {
      entries.push(parseEntryHeader(line.slice(2), filename));
      pending = 0;
      continue;
    }
    // Still checked before the blank-line case, for files written by earlier
    // versions: a line of exactly four spaces is an in-comment blank line, and
    // slicing INDENT off leaves the '' that says so.
    if (line.startsWith(INDENT)) {
      const current = entries[entries.length - 1];
      if (current === undefined) {
        throw new DzError('PARSE_ERROR', `${filename}: continuation line before any log entry`);
      }
      const piece = `${'\n'.repeat(pending)}${line.slice(INDENT.length)}`;
      current.text = current.text === null ? piece : `${current.text}\n${piece}`;
      pending = 0;
      continue;
    }
    if (line.trim() === '') {
      // Nothing to attach it to yet: the blank between '## Log' and the first
      // entry is neither content nor separation.
      if (entries.length > 0) pending++;
      continue;
    }
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
      // A blank line is written blank. Indenting it would put trailing
      // whitespace in the file, which no ordinary text tool preserves: an
      // editor that strips on save, or `git apply --whitespace=fix`, would
      // silently rewrite someone's comment. parseLog recovers the blank from
      // the continuation line that follows it instead.
      for (const line of e.text.split('\n')) out += line === '' ? '\n' : `${INDENT}${line}\n`;
    }
  }
  return out;
}
