/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { meAs, parseQuery } from '../src/query.js';

describe('parseQuery', () => {
  it('is empty for empty text', () => {
    expect(parseQuery('', null)).toEqual({ filter: {}, pattern: null });
    expect(parseQuery('   ', null)).toEqual({ filter: {}, pattern: null });
  });

  it('turns key:value terms into filter fields', () => {
    expect(parseQuery('status:open type:bug component:cli', null).filter)
      .toEqual({ status: 'open', type: 'bug', component: 'cli' });
  });

  it('treats bare words as one regex, in the order typed', () => {
    expect(parseQuery('drops a newline', null))
      .toEqual({ filter: {}, pattern: 'drops a newline' });
  });

  it('mixes the two, in any order', () => {
    expect(parseQuery('tokenizer status:open', null))
      .toEqual({ filter: { status: 'open' }, pattern: 'tokenizer' });
    expect(parseQuery('status:open tokenizer', null))
      .toEqual({ filter: { status: 'open' }, pattern: 'tokenizer' });
  });

  it('expands assignee:me to the author email', () => {
    expect(parseQuery('assignee:me', meAs('Jane Roe <jane@example.com>')).filter)
      .toEqual({ assignee: 'jane@example.com' });
  });

  it('falls back to the whole author when it carries no email', () => {
    expect(parseQuery('assignee:me', meAs('jane')).filter)
      .toEqual({ assignee: 'jane' });
  });

  it('leaves assignee:me alone when there is no identity', () => {
    // Better a filter that matches nothing than one that silently matches the
    // literal string "me" and shows a list the operator will misread.
    expect(parseQuery('assignee:me', meAs(null)).filter)
      .toEqual({ assignee: 'me' });
  });

  it('does not treat "me" as special for other keys', () => {
    expect(parseQuery('component:me', meAs('Jane Roe <jane@example.com>')).filter)
      .toEqual({ component: 'me' });
  });

  it('reads all: as the --all flag', () => {
    expect(parseQuery('all:true', null).filter).toEqual({ all: true });
    expect(parseQuery('all:false', null).filter).toEqual({ all: false });
  });

  it('drops a bare all: instead of leaking it into the regex', () => {
    // "all:" exists for one keystroke on the way to "all:true". Treating it as
    // a bare word puts the literal text "all:" in the pattern, which matches
    // nothing and empties the list mid-word.
    expect(parseQuery('all:', null)).toEqual({ filter: {}, pattern: null });
    expect(parseQuery('all:true all:', null).filter).toEqual({});
  });

  it('lets an empty value clear a key set earlier in the same text', () => {
    expect(parseQuery('status:open status:', null).filter).toEqual({});
  });

  it('drops a key with an empty value instead of failing on it', () => {
    // Typing is incremental: "status:" exists for one keystroke on the way to
    // "status:open", and must not be an error the operator has to read.
    expect(parseQuery('status: tokenizer', null))
      .toEqual({ filter: {}, pattern: 'tokenizer' });
  });

  it('leaves an unknown key as part of the regex', () => {
    // http://example.com is a bare word, not a filter on the key "http".
    expect(parseQuery('http://example.com', null))
      .toEqual({ filter: {}, pattern: 'http://example.com' });
  });

  it('lets the last mention of a key win', () => {
    expect(parseQuery('status:open status:closed', null).filter)
      .toEqual({ status: 'closed' });
  });

  it('does not validate the vocabulary itself', () => {
    // applyFilter owns that rule and raises INVALID_FIELD. A second copy here
    // would be free to drift from it.
    expect(parseQuery('status:nope', null).filter).toEqual({ status: 'nope' });
  });
});
