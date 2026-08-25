/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export type DzErrorCode =
  | 'NO_PROJECT'
  | 'NOT_FOUND'
  | 'AMBIGUOUS_PREFIX'
  | 'INVALID_FIELD'
  | 'PARSE_ERROR'
  | 'CONFLICT_MARKERS'
  | 'LOCKED'
  | 'CONCURRENT_MODIFICATION';

export class DzError extends Error {
  readonly code: DzErrorCode;

  constructor(code: DzErrorCode, message: string) {
    super(message);
    this.name = 'DzError';
    this.code = code;
  }
}

export const EXIT_SUCCESS = 0;
export const EXIT_USER_ERROR = 1;
export const EXIT_USAGE_ERROR = 2;
export const EXIT_INTERNAL_ERROR = 3;
