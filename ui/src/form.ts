/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { DEFAULT_ISSUE_TYPE, ISSUE_TYPES, SETTABLE_STATUSES } from 'ditz2';
import type { EditableFields, Issue, NewIssue } from 'ditz2';
import { moveSelection } from './components/Picker.js';

/** `set` on the selected issue, or `add` of a new one. */
export type FormMode = 'set' | 'add';

export type FormField = 'title' | 'type' | 'status' | 'component' | 'assignee';

/** Every field `set` takes, in the order the spec's mock draws them. */
export const SET_FIELDS: readonly FormField[] =
  ['title', 'type', 'status', 'component', 'assignee'];

/**
 * The two `NewIssue` has no member for.
 *
 * `createIssue` always produces an open, unassigned issue and the facade
 * offers no way to say otherwise, so `add` could not carry either. They are
 * left out of the new-issue form rather than drawn and ignored: a field on the
 * screen is a field the operator will fill in.
 */
const NOT_AT_CREATION: readonly FormField[] = ['status', 'assignee'];

export const ADD_FIELDS: readonly FormField[] =
  SET_FIELDS.filter((f) => !NOT_AT_CREATION.includes(f));

export function fieldsFor(mode: FormMode): readonly FormField[] {
  return mode === 'add' ? ADD_FIELDS : SET_FIELDS;
}

/**
 * What the form is holding.
 *
 * `component` is `string | null` and `assignee` is a plain string, which is
 * not an oversight: a picker needs a value for "none" that no component name
 * can collide with, and a text field's nothing is the empty string. The two
 * are converted at the edge, in `changedFields`.
 *
 * `readonly` because `EMPTY_VALUES` is a shared module-level object. Nothing
 * in this module can poison it — every update here is copy-on-write — but a
 * consumer holding form values in reducer state is one in-place assignment
 * away from corrupting the default for the rest of the process, and that is
 * a defect no test would localise to here.
 */
export interface FormValues {
  readonly title: string;
  readonly type: string;
  readonly status: string;
  readonly component: string | null;
  readonly assignee: string;
}

export function valuesOf(issue: Issue): FormValues {
  return {
    title: issue.title,
    type: issue.type,
    status: issue.status,
    component: issue.component,
    assignee: issue.assignee ?? '',
  };
}

/**
 * Where `n` starts.
 *
 * `status` is never read in add mode — it is not one of `ADD_FIELDS` and
 * `newIssueFrom` does not carry it — but `FormValues` is one shape, so it
 * needs a value, and the first settable status is what `createIssue` will
 * produce anyway.
 */
export const EMPTY_VALUES: FormValues = {
  title: '',
  type: DEFAULT_ISSUE_TYPE,
  status: SETTABLE_STATUSES[0]!,
  component: null,
  assignee: '',
};

/** What each picker field offers. Built once, when the form opens. */
export interface FormChoices {
  type: readonly string[];
  status: readonly string[];
  /** null is "no component", and is always first. */
  component: readonly (string | null)[];
}

export const NO_COMPONENT = '(none)';

/**
 * How the component picker spells no component.
 *
 * A configured component can in fact be called `(none)`: `component add`
 * rejects only a name that is empty after trimming. The selection itself is
 * unaffected — the picker moves by index and `FormValues.component` carries
 * the real value, so the wrong entry is never chosen or saved. The collision
 * is display-only with one exception: `Picker` keys its rows by the option
 * string, so two identical labels produce duplicate React keys. That is a
 * real if small consequence, not purely cosmetic, and it belongs to the
 * picker's keying rather than to this function.
 */
export function componentLabel(component: string | null): string {
  return component ?? NO_COMPONENT;
}

/**
 * The vocabulary, plus the value the issue already has when the facade would
 * not accept that value back.
 *
 * A closed issue's status is the case: `set` refuses it, so it is not in
 * `SETTABLE_STATUSES`, but the form has to be able to show it. Leaving it out
 * would mark the first option instead — `open` over an issue that is closed —
 * and any other edit would then post that as a change nobody made. Selecting
 * the extra option changes nothing, so it never reaches the facade.
 */
function withCurrent(options: readonly string[], current: string | null): string[] {
  if (current === null || options.includes(current)) return [...options];
  return [...options, current];
}

/**
 * No `mode` parameter: add mode passes a null `original`, which makes both the
 * `withCurrent` fallback and the orphaned-component push no-op on their own.
 * The mode is what picks the *field list*, in `fieldsFor` — not the choices.
 */
export function choicesFor(
  original: Issue | null, configured: readonly string[],
): FormChoices {
  const component: (string | null)[] = [null, ...configured];
  // The same rule as withCurrent, over a list whose members are nullable.
  // `component rm --force` is what leaves an issue holding one nobody lists.
  if (original?.component != null && !configured.includes(original.component)) {
    component.push(original.component);
  }
  return {
    // No withCurrent: an issue whose type is outside the vocabulary does not
    // parse, so it never reaches a form.
    type: [...ISSUE_TYPES],
    status: withCurrent(SETTABLE_STATUSES, original?.status ?? null),
    component,
  };
}

/**
 * The options a field offers, or null when the field is typed.
 *
 * The one place that says which fields are pickers. The layout, the row
 * budget and the key handler all ask here.
 */
export function optionsFor(choices: FormChoices, field: FormField): readonly string[] | null {
  switch (field) {
    case 'type': return choices.type;
    case 'status': return choices.status;
    case 'component': return choices.component.map(componentLabel);
    case 'title':
    case 'assignee': return null;
  }
}

/**
 * The text a typed field holds, or null when the field is picked.
 *
 * The other half of the partition `optionsFor` makes, and the one the key
 * handler drives off: a field is picked or it is typed, never both and never
 * neither. Both are exhaustive switches over `FormField`, so a sixth field
 * fails to compile in both places at once — and a test below asserts the
 * partition itself, which is what stops the two halves agreeing that some
 * field is neither.
 */
export function textOf(values: FormValues, field: FormField): string | null {
  switch (field) {
    case 'title': return values.title;
    case 'assignee': return values.assignee;
    case 'type':
    case 'status':
    case 'component': return null;
  }
}

/** Puts edited text back in the field it came from. */
export function typeInto(values: FormValues, field: FormField, text: string): FormValues {
  switch (field) {
    case 'title': return { ...values, title: text };
    case 'assignee': return { ...values, assignee: text };
    case 'type':
    case 'status':
    case 'component': return values;
  }
}

/** Where the current value sits in its own picker, or -1 for a typed field. */
export function indexOf(values: FormValues, choices: FormChoices, field: FormField): number {
  switch (field) {
    case 'type': return choices.type.indexOf(values.type);
    case 'status': return choices.status.indexOf(values.status);
    case 'component': return choices.component.indexOf(values.component);
    case 'title':
    case 'assignee': return -1;
  }
}

/**
 * The values `delta` steps away, or the values unchanged.
 *
 * No stored index: `values` is the only place a choice lives and the index is
 * recomputed from it, so there is nothing that can disagree with what the form
 * is about to save.
 */
export function pick(
  values: FormValues, choices: FormChoices, field: FormField, delta: number,
): FormValues {
  const at = indexOf(values, choices, field);
  if (at < 0) return values;
  switch (field) {
    case 'type':
      return { ...values, type: choices.type[moveSelection(at, delta, choices.type.length)]! };
    case 'status':
      return { ...values, status: choices.status[moveSelection(at, delta, choices.status.length)]! };
    case 'component':
      return {
        ...values,
        component: choices.component[moveSelection(at, delta, choices.component.length)] ?? null,
      };
    case 'title':
    case 'assignee':
      return values;
  }
}

/**
 * Tab is a ring; a picker's arrows are not.
 *
 * `moveSelection` clamps on purpose, so the ends of a short option list feel
 * like ends. Focus is the opposite case: five fields with a dead end at each
 * one means reversing all the way back to reach the title, and the close
 * overlay's two-field Tab already wraps. Two rules, each argued where it is.
 */
export function moveFocus(
  fields: readonly FormField[], from: FormField, delta: 1 | -1,
): FormField {
  const at = fields.indexOf(from);
  if (at < 0) return fields[0]!;
  return fields[(at + delta + fields.length) % fields.length]!;
}

/**
 * Only what the operator actually changed.
 *
 * Two reasons, and the second is the one that matters. Measured against the
 * built `dz`: `set --title 'a title' --type task`, with both already those
 * values, appends `title | a title -> a title` and `type | task -> task` to
 * the log, so sending all five would write four lies on every save. And
 * `setFields` has no compare-and-swap — it re-reads the issue under the lock
 * and writes whatever it was handed — so a form left open while somebody else
 * retitles the issue would silently undo them. A diff narrows that to the
 * fields the operator meant to touch.
 */
export function changedFields(before: FormValues, after: FormValues): EditableFields {
  const out: EditableFields = {};
  if (after.title !== before.title) out.title = after.title;
  if (after.type !== before.type) out.type = after.type;
  if (after.status !== before.status) out.status = after.status;
  if (after.component !== before.component) out.component = after.component;
  if (after.assignee !== before.assignee) {
    out.assignee = after.assignee === '' ? null : after.assignee;
  }
  return out;
}

/** Nothing to save. `setFields` refuses an empty patch, and rightly. */
export function isUnchanged(fields: EditableFields): boolean {
  return Object.keys(fields).length === 0;
}

/**
 * The new issue `add` will create.
 *
 * Typed as `NewIssue` rather than passed through as a literal, so a member
 * added to the facade's interface stops this compiling instead of being
 * quietly omitted. No body: nothing in the UI can edit one until plan 2d, and
 * `add` defaults it to empty.
 */
export function newIssueFrom(values: FormValues): NewIssue {
  return { title: values.title, type: values.type, component: values.component };
}
