/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/** The single seam through which the tool reads wall-clock time. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * The `date-time` shape the JSON Schema promises, as an actual predicate.
 *
 * `Date.parse` alone is far too permissive — it accepts "2026" and a good deal
 * of prose — so the shape is checked first and the value second, which rejects
 * a well-formed but impossible "2026-02-31T00:00:00Z". Hand-edited issue files
 * are the reason this exists: nothing else can put a bad timestamp in one.
 */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function isIsoTimestamp(value: string): boolean {
  if (!ISO_TIMESTAMP.test(value)) return false;
  if (Number.isNaN(new Date(value).getTime())) return false;

  // "2026-02-31T00:00:00Z" parses: V8 rolls it forward to 2026-03-03. The
  // calendar day is checked on its own, pinned to UTC, so that a legitimate
  // offset like "2026-08-24T02:00:00+05:00" -- which is the 23rd in UTC -- is
  // not mistaken for a rollover.
  const day = value.slice(0, 10);
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}
