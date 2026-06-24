/**
 * Shared `file://` URI helper for the slice-15 backup/restore adapters
 * (audit Y-5: previously two divergent copies — `icloudBackupAdapter.ts`
 * encodeURI vs `restoreDepsWiring.ts` raw concat — were a future footgun).
 *
 * Pure string logic; safe to import under jest's node env.
 */

/**
 * Normalize a filesystem path OR an already-formed URI to a `file://` URI.
 *
 * - Idempotent: an input already starting with `file://` is returned as-is.
 * - Spaces and other unsafe chars are percent-encoded (`encodeURI` keeps
 *   `/` so path structure is preserved). iOS sandbox paths and the iCloud
 *   ubiquity container both can contain spaces (`.../Mobile Documents/...`),
 *   and expo-sqlite hands out plain POSIX paths that must be encoded before
 *   expo-file-system's File/Directory will accept them.
 */
export function toFileUri(pathOrUri: string): string {
  if (pathOrUri.startsWith('file://')) return pathOrUri;
  return `file://${encodeURI(pathOrUri)}`;
}

/**
 * Inverse of {@link toFileUri}: reduce a `file://` URI (or an already-plain
 * path) to a plain, percent-decoded POSIX path.
 *
 * - Idempotent: an input without a `file://` scheme is returned (decoded) as-is.
 * - Why this exists: expo-sqlite's `directory` argument is contractually a
 *   plain path — iOS native `defaultDatabaseDirectory` is
 *   `documentDirectory.appendingPathComponent("SQLite").standardized.path`
 *   (`.path`, not a URI), and `createDatabasePath` just string-concats it.
 *   A restore candidate is sourced from expo-file-system / the iCloud
 *   container, both `file://` URIs, so it must be reduced before being split
 *   into (name, directory) for `openDatabaseAsync` — otherwise we rely on the
 *   native layer tolerating an off-contract `file://` prefix.
 * - A malformed `%` escape can't be decoded; rather than throw on a path the
 *   OS could still open verbatim, the stripped (un-decoded) path is returned.
 */
export function fromFileUri(pathOrUri: string): string {
  const stripped = pathOrUri.startsWith('file://')
    ? pathOrUri.slice('file://'.length)
    : pathOrUri;
  try {
    return decodeURI(stripped);
  } catch {
    return stripped;
  }
}
