/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, Text } from 'ink';
import React from 'react';
import { shortId } from 'ditz2';
import type { Issue } from 'ditz2';
import { UNASSIGNED, truncate } from '../format.js';
import { Picker } from './Picker.js';
import { TextEntry } from './TextEntry.js';
import { componentLabel, fieldsFor, indexOf, optionsFor, textOf } from '../form.js';
import type { FormChoices, FormField, FormMode, FormValues } from '../form.js';

/** Wide enough for `Component`, plus the gap the values line up after. */
const LABEL_WIDTH = 11;
/** The mark column and the space after it, which every row carries. */
const MARK_WIDTH = 2;
/** Heading, spacer, spacer, body — the rows that are not fields. */
const CHROME = 4;

/**
 * The most rows the form can need, which is what App refuses to open below.
 *
 * Only the focused picker is expanded, so the height depends on which field
 * has focus — and focus moves while the form is open, so the floor is the
 * tallest arrangement rather than the current one. A picker that fits when it
 * opens and overflows two Tabs later is the clipped-selection failure the
 * close overlay's floor exists to prevent.
 *
 * Exported because App is the one that has to refuse, and computed from the
 * same `choices` the layout draws from: a second count living beside the check
 * would be free to drift from the thing it describes.
 */
export function formRows(mode: FormMode, choices: FormChoices): number {
  const fields = fieldsFor(mode);
  const tallest = Math.max(
    ...fields.map((field) => optionsFor(choices, field)?.length ?? 0),
  );
  return fields.length + tallest + CHROME;
}

/** How many lines of body a save will leave alone. */
function bodyLines(issue: Issue | null): number {
  if (issue === null || issue.body === '') return 0;
  return issue.body.split('\n').length;
}

function label(field: FormField): string {
  return `${field[0]!.toUpperCase()}${field.slice(1)}`.padEnd(LABEL_WIDTH);
}

/**
 * What an unfocused field shows.
 *
 * `unassigned` is the word `format.ts` already uses on the detail line. It is
 * only shown when the field does not have focus: a placeholder inside a field
 * being typed into is something the operator has to delete first.
 */
function shown(values: FormValues, field: FormField): string {
  switch (field) {
    case 'title': return values.title;
    case 'type': return values.type;
    case 'status': return values.status;
    case 'component': return componentLabel(values.component);
    case 'assignee': return values.assignee === '' ? UNASSIGNED : values.assignee;
  }
}

/** What both modes need, whether or not there is an issue behind the form. */
interface FormCommon {
  values: FormValues;
  choices: FormChoices;
  focus: FormField;
  width: number;
}

/**
 * The mode and its subject, as one choice rather than two props.
 *
 * A union, not `mode: FormMode` beside `issue: Issue | null`, because those two
 * are not independent: `set` has an issue and `add` has none, and the flat
 * shape lets a caller pass `mode='set'` with `issue={null}`, which reaches the
 * heading as a null dereference — an Ink render crash, at runtime, in the
 * composing caller rather than here. App is that caller, so the miswiring is
 * exactly the "verified components, wrongly composed" case: this file was
 * reviewed and correct, and the pairing it assumed lived somewhere else. The
 * union makes that mistake a compile error at the composition site.
 */
export type FormSubject =
  | { mode: 'set'; issue: Issue }
  | { mode: 'add'; issue: null };

export function FormOverlay(
  { mode, issue, values, choices, focus, width }: FormCommon & FormSubject,
): React.ReactElement {
  const heading = mode === 'add'
    ? 'new issue'
    : `edit ${shortId(issue.id)}  ${issue.title}`;
  // The value column, for the fields that draw one.
  const room = Math.max(width - LABEL_WIDTH - MARK_WIDTH, 1);

  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate">{truncate(heading, width)}</Text>
      <Text> </Text>
      {fieldsFor(mode).map((field) => {
        const on = field === focus;
        const mark = on ? '>' : ' ';
        const options = optionsFor(choices, field);
        if (options !== null && on) {
          return (
            <Box flexDirection="column" key={field}>
              <Text wrap="truncate">{truncate(`${mark} ${label(field)}`, width)}</Text>
              <Picker options={options} selected={indexOf(values, choices, field)} width={width} />
            </Box>
          );
        }
        // `textOf` is the other half of the partition `optionsFor` makes — a
        // field is picked or it is typed — so asking it rather than casting
        // `values[field]` keeps both halves answered in the one place that
        // owns the partition. A field that were somehow neither falls through
        // to the unfocused row instead of through a cast that hid it.
        const text = textOf(values, field);
        if (text !== null && on) {
          return (
            <Box key={field}>
              <Text wrap="truncate">{`${mark} ${label(field)}`}</Text>
              {/* The block cursor lives in one place, and this is it. */}
              <TextEntry lines={[text]} rows={1} width={room} />
            </Box>
          );
        }
        return (
          <Text key={field} wrap="truncate">
            {truncate(`${mark} ${label(field)}${shown(values, field)}`, width)}
          </Text>
        );
      })}
      <Text> </Text>
      <Text dimColor wrap="truncate">
        {truncate(`  ${'Body'.padEnd(LABEL_WIDTH)}${bodyLines(issue)} lines`, width)}
      </Text>
    </Box>
  );
}
