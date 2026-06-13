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
