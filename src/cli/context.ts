/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export interface CliContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  json: boolean;
  /** Commands raise this to signal partial failure without throwing. */
  exitCode: number;
}

export function write(stream: NodeJS.WritableStream, text: string): void {
  stream.write(text);
}
