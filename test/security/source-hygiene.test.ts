import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Properties of the source text that review and a release build depend on.
 *
 * Two of this app's security boundaries are regular expressions — the text
 * sanitisers on either side of the AI endpoints — and they once held raw NUL
 * and direction-override characters. Git treats a file with a NUL byte as
 * binary, so every change to those boundaries showed up in review as "Bin"
 * with no diff at all. Invisible characters are written as escapes instead.
 *
 * And a release build has no crash reporter, but its console still reaches the
 * system log. SQLite driver errors quote the failed statement's parameters —
 * an amount, a note, a person's name — so the app logs only in development.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function* walk(directory: string): Generator<string> {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx|js|mjs|json|sql)$/.test(path)) yield path;
  }
}

const name = (path: string) => relative(root, path).split(sep).join('/');

/** Control characters other than tab, line feed and carriage return; C1; zero-width and direction overrides; BOM. */
const HIDDEN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/;

describe('source a reviewer can read', () => {
  it('writes invisible and control characters in app and function code as escapes', () => {
    const offenders = [...walk(join(root, 'src')), ...walk(join(root, 'supabase'))]
      .filter((file) => HIDDEN.test(readFileSync(file, 'utf8')))
      .map(name);
    expect(offenders).toEqual([]);
  });

  it('has no NUL byte anywhere, so Git never hides a change as a binary file', () => {
    const offenders = ['src', 'supabase', 'test']
      .flatMap((directory) => [...walk(join(root, directory))])
      .filter((file) => readFileSync(file).includes(0))
      .map(name);
    expect(offenders).toEqual([]);
  });
});

describe('logging in a release build', () => {
  it('happens only in development', () => {
    const offenders: string[] = [];
    for (const file of walk(join(root, 'src'))) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        if (!/\bconsole\.(?:log|info|warn|error|debug|trace)\b/.test(line)) return;
        // Guarded on the same line, or by the `if` that opens its block.
        const guarded = line.includes('__DEV__') || (lines[index - 1] ?? '').includes('__DEV__');
        if (!guarded) offenders.push(`${name(file)}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
