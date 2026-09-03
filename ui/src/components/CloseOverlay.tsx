/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, Text } from 'ink';
import React from 'react';
import { RESOLUTIONS, shortId } from 'ditz2';
import type { Issue } from 'ditz2';
import { truncate } from '../format.js';
import { Picker } from './Picker.js';
import { TextEntry } from './TextEntry.js';

export type CloseFocus = 'resolution' | 'comment';

/**
 * The fewest rows this overlay can draw itself in.
 *
 * The title, a spacer, one line per resolution, a spacer, the comment label
 * and one line of the comment. None of it is droppable — a picker showing two
 * of three resolutions while the arrows move a selection off the screen is
 * exactly the "display stops matching the state" failure the row budget in
 * `app.tsx` exists to prevent — so this is a floor rather than a preference,
 * and App refuses to open the overlay below it.
 *
 * Exported because App is the one that has to refuse. A second copy of this
 * arithmetic living beside the check would be free to drift from the layout it
 * is describing, which is the whole of the `dz doctor` lesson in `CLAUDE.md`.
 */
export const CLOSE_OVERLAY_ROWS = RESOLUTIONS.length + 5;

/**
 * The resolutions come from `ditz2`. A literal here would be a second copy of
 * a vocabulary `close` already validates, and the two would be free to drift.
 */
export function CloseOverlay(
  { issue, resolution, lines, focus, rows, width }:
  {
    issue: Issue; resolution: number; lines: string[];
    focus: CloseFocus; rows: number; width: number;
  },
): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate">
        {truncate(`close ${shortId(issue.id)}  ${issue.title}`, width)}
      </Text>
      <Text> </Text>
      <Picker
        options={RESOLUTIONS}
        selected={resolution}
        width={width}
        dim={focus !== 'resolution'}
      />
      <Text> </Text>
      <Text dimColor={focus !== 'comment'} wrap="truncate">
        {truncate('  comment (optional)', width)}
      </Text>
      <TextEntry
        lines={lines}
        // The same arithmetic the magic `5` here used to spell, named. The
        // minimum already counts one line of comment, so at every height
        // above the floor the entry gives back a row it could have used —
        // left that way deliberately, for the reason app.tsx gives about its
        // own budget: a wasted line costs nothing and a line too many makes
        // Ink scroll the frame.
        rows={Math.max(rows - CLOSE_OVERLAY_ROWS, 1)}
        width={width}
      />
    </Box>
  );
}
