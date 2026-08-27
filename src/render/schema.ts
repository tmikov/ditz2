/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A JSON Schema for everything `--json` puts on stdout or stderr.
 *
 * The schema document is versioned; the payloads are not. Adding a
 * `schemaVersion` field to each payload was the obvious alternative and does
 * not work: `dz list --json` is a bare array, so versioning it in-band means
 * wrapping it in an object, which breaks every existing consumer and makes
 * `list` inconsistent with `show`. Publishing a versioned document instead
 * costs consumers nothing and still gives them something to validate against.
 *
 * Bump SCHEMA_VERSION and the `$id` when a payload shape changes
 * incompatibly. `dz schema` prints this, and a test validates real command
 * output against it — that test is the part with value, since a schema nobody
 * checks drifts from the code within a release.
 */
export const SCHEMA_VERSION = 1;

const ISSUE_ID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

export const JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `https://github.com/tmikov/ditz2/schema/v${SCHEMA_VERSION}.json`,
  title: 'ditz2 --json output',
  description:
    'Payloads written by dz under --json. Results go to stdout; errors and '
    + 'warnings go to stderr, where the whole stream is a single object. '
    + '`dz help` is prose and is not covered here.',
  schemaVersion: SCHEMA_VERSION,

  $defs: {
    logEntry: {
      type: 'object',
      description: 'One append-only entry in an issue log.',
      properties: {
        timestamp: { type: 'string', format: 'date-time' },
        author: { type: 'string' },
        verb: { type: 'string', pattern: '^[a-z]+$' },
        detail: { type: ['string', 'null'] },
        text: {
          type: ['string', 'null'],
          description: 'Continuation lines, carrying a comment body.',
        },
      },
      required: ['timestamp', 'author', 'verb', 'detail', 'text'],
      additionalProperties: false,
    },

    issue: {
      type: 'object',
      description: 'One issue, as `dz show --json` emits it.',
      properties: {
        id: { type: 'string', pattern: ISSUE_ID_PATTERN },
        title: { type: 'string', minLength: 1 },
        type: { enum: ['bug', 'feature', 'task'] },
        status: { enum: ['open', 'in-progress', 'closed'] },
        resolution: {
          oneOf: [{ enum: ['fixed', 'wontfix', 'duplicate'] }, { type: 'null' }],
          description: 'Non-null exactly when status is "closed".',
        },
        component: { type: ['string', 'null'] },
        assignee: { type: ['string', 'null'] },
        created: { type: 'string', format: 'date-time' },
        creator: { type: 'string' },
        body: { type: 'string' },
        log: { type: 'array', items: { $ref: '#/$defs/logEntry' } },
        unknown: {
          type: 'object',
          description: 'Frontmatter keys this version does not recognise, preserved verbatim.',
        },
      },
      required: [
        'id', 'title', 'type', 'status', 'resolution', 'component',
        'assignee', 'created', 'creator', 'body', 'log', 'unknown',
      ],
      additionalProperties: false,
    },

    issueList: {
      type: 'array',
      description: '`dz list --json` and `dz grep --json`. Ordered by creation, ascending.',
      items: { $ref: '#/$defs/issue' },
    },

    errorEnvelope: {
      type: 'object',
      description: 'stderr when a command fails. stdout is empty in that case.',
      properties: {
        error: {
          type: 'object',
          properties: {
            code: {
              enum: [
                'NO_PROJECT', 'NOT_FOUND', 'AMBIGUOUS_PREFIX', 'INVALID_FIELD',
                'PARSE_ERROR', 'CONFLICT_MARKERS', 'LOCKED',
                'CONCURRENT_MODIFICATION', 'USAGE_ERROR', 'INTERNAL',
              ],
            },
            message: { type: 'string' },
          },
          required: ['code', 'message'],
          additionalProperties: false,
        },
      },
      required: ['error'],
      additionalProperties: false,
    },

    warningsEnvelope: {
      type: 'object',
      description:
        'stderr on partial failure: list and grep skipped a file, still printed '
        + 'their results to stdout, and exited 1.',
      properties: {
        warnings: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              file: { type: 'string' },
              code: { enum: ['PARSE_ERROR', 'CONFLICT_MARKERS', 'INVALID_FIELD'] },
              message: { type: 'string' },
            },
            required: ['file', 'code', 'message'],
            additionalProperties: false,
          },
        },
      },
      required: ['warnings'],
      additionalProperties: false,
    },

    doctorReport: {
      type: 'object',
      description: '`dz doctor --json`. An empty problems array means healthy.',
      properties: {
        fixed: {
          type: 'array',
          description: 'Present only under --fix: the files it rewrote, and what it did to each. Absent, not empty, when --fix was not passed.',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['file', 'message'],
            additionalProperties: false,
          },
        },
        problems: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              file: { type: ['string', 'null'] },
              message: { type: 'string' },
              remedy: { type: 'string' },
            },
            required: ['code', 'file', 'message', 'remedy'],
            additionalProperties: false,
          },
        },
      },
      required: ['problems'],
      additionalProperties: false,
    },

    initResult: {
      type: 'object',
      description: '`dz init --json`.',
      properties: {
        name: { type: 'string', description: 'The name in effect, which on a re-init is the existing one.' },
        requestedName: { type: 'string' },
        root: { type: 'string' },
        author: { type: ['string', 'null'] },
        authorRejected: {
          type: ['string', 'null'],
          description: 'A probed identity that was refused because it collides with the log grammar.',
        },
      },
      required: ['name', 'requestedName', 'root', 'author', 'authorRejected'],
      additionalProperties: false,
    },

    componentList: {
      type: 'object',
      description: '`dz component list|add|rm --json`.',
      properties: {
        components: { type: 'array', items: { type: 'string' } },
      },
      required: ['components'],
      additionalProperties: false,
    },

    unlockResult: {
      type: 'object',
      description: '`dz unlock --json`. `removed` is false when there was no lock to remove.',
      properties: {
        removed: { type: 'boolean' },
      },
      required: ['removed'],
      additionalProperties: false,
    },
  },
} as const;
