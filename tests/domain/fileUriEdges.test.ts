import { toFileUri } from '../../src/domain/backup/fileUri';

/**
 * Slice 15 audit Y-5 — `toFileUri` EDGE characteristics (recent-main bug-hunt
 * report 02, 2026-06-17, finding #4 + the report's URI-handling note that
 * `restoreDepsWiring`'s raw-concat is only safe because backup filenames
 * contain no special chars).
 *
 * The shipped `fileUri.test.ts` covers bare-path prefixing, idempotency and
 * space encoding. This file pins the SHARP EDGES of the `encodeURI`-based
 * implementation so a future change to the helper is loud — and so the
 * "safe today because filenames are plain" assumption is documented in a
 * test, not just prose:
 *
 *   - `encodeURI` deliberately does NOT encode the URI-reserved `#` and `?`
 *     (and `/`, `:`, `@`, `&`, `=`, `+`, `$`, `,`): a path containing one of
 *     those would NOT be fully escaped. Benign today (our names are plain),
 *     but pinned so a future filename scheme that introduces them gets caught.
 *   - already-percent-encoded input is RE-encoded (`%` → `%25`): `toFileUri`
 *     is only idempotent on inputs that already start with `file://`, NOT on
 *     a bare path that happens to contain `%`. Pin this so callers don't
 *     accidentally double-pass a path through it.
 */

describe('toFileUri — encodeURI reserved-character characteristics', () => {
  it('encodes spaces but LEAVES the reserved # and ? (encodeURI semantics)', () => {
    expect(toFileUri('/a b/c#d.sqlite')).toBe('file:///a%20b/c#d.sqlite');
    expect(toFileUri('/dir/q?x.sqlite')).toBe('file:///dir/q?x.sqlite');
  });

  it('preserves path structure — forward slashes and colons stay literal', () => {
    expect(toFileUri('/private/var/A:B/Mobile Documents/x.sqlite')).toBe(
      'file:///private/var/A:B/Mobile%20Documents/x.sqlite'
    );
  });

  it('leaves +, &, =, @ untouched (all encodeURI-unreserved)', () => {
    expect(toFileUri('/a+b/c&d=e@f.sqlite')).toBe('file:///a+b/c&d=e@f.sqlite');
  });

  it('encodes non-ASCII path segments (CJK / accented)', () => {
    expect(toFileUri('/備份/Übung.sqlite')).toBe(
      `file://${encodeURI('/備份/Übung.sqlite')}`
    );
    // Sanity: the raw CJK bytes are percent-encoded, not passed through.
    expect(toFileUri('/備份/x.sqlite')).toContain('%');
  });
});

describe('toFileUri — idempotency boundary', () => {
  it('is idempotent ONLY on inputs already starting with file:// (no double-encode)', () => {
    const uri = 'file:///dir/Mobile%20Documents/x.sqlite';
    expect(toFileUri(uri)).toBe(uri);
    expect(toFileUri(toFileUri(uri))).toBe(uri);
  });

  it('RE-encodes a bare path containing % (NOT idempotent on bare paths)', () => {
    // Documents the footgun: passing an already-encoded BARE path (no file://
    // prefix) double-encodes it. The audit chain only ever feeds toFileUri a
    // plain POSIX path or an existing file:// URI, so this is latent — pinned
    // so a caller that pre-encodes gets a loud, correct failure here.
    expect(toFileUri('/dir/Mobile%20Documents/x.sqlite')).toBe(
      'file:///dir/Mobile%2520Documents/x.sqlite'
    );
  });

  it('produces a string that re-prefixes idempotently once it carries file://', () => {
    const once = toFileUri('/sandbox/Documents/SQLite/traininglog.db');
    expect(toFileUri(once)).toBe(once);
  });
});
