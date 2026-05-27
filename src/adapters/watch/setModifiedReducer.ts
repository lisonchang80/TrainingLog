/**
 * Slice 13d / D20 — per-field LWW (Last-Write-Wins) reducer for the
 * `set-modified` WC message kind.
 *
 * ADR-0019 NEW-Q43 chose **Option A**: in-memory `(setId, fieldName) → ts`
 * map. Concurrent edits from iPhone + Watch on the same set converge
 * field-by-field — the writer with the larger client-side timestamp on
 * that field wins; the other field's value silently drops. The map is
 * cleared on session end (`clearLwwMap`) so it never grows across
 * sessions.
 *
 * Tiebreak rule: a tie (`incomingTs === existingTs`) keeps the prior
 * value. Newness requires strict `>`. This is the deterministic choice
 * because the two ends never share an authoritative clock — a tie is
 * almost always two senders happening to snap to the same epoch ms;
 * accepting the new one is no more "right" than keeping the old.
 *
 * Field-ts fallback: when `fieldTs[field]` is missing, the envelope-
 * level `ts` is used as the implicit field ts (per the payloadSchema
 * comment at line 174-176).
 *
 * Forward-compat: diff keys outside the known `SetModifiedPayload['diff']`
 * shape are silently skipped (not rejected) so a newer Watch shipping an
 * unknown field never crashes an older iPhone.
 */

import type { SetModifiedPayload } from './payloadSchema';

const KNOWN_FIELDS = [
  'weight',
  'reps',
  'rpe',
  'rest_sec',
  'notes',
  'set_kind',
] as const;

export type DiffField = (typeof KNOWN_FIELDS)[number];

export interface LwwMap {
  /** Key = `${setId}:${fieldName}`. Value = epoch ms of the last accepted write. */
  ts: Map<string, number>;
}

export interface AdmitDiffResult {
  /** Fields whose write was admitted into the mirror state. */
  accepted: SetModifiedPayload['diff'];
  /** Field names whose write was rejected because the map already holds a newer ts. */
  rejected: string[];
}

export function createLwwMap(): LwwMap {
  return { ts: new Map() };
}

export function clearLwwMap(map: LwwMap): void {
  map.ts.clear();
}

function isKnownField(field: string): field is DiffField {
  return (KNOWN_FIELDS as readonly string[]).includes(field);
}

/**
 * Apply a `set-modified` envelope's diff against the LWW map. Mutates
 * `map` in place: any field whose write is admitted updates its ts
 * entry to the incoming `incomingTs`. Returns the subset of the diff
 * the caller should actually apply to mirror state, plus a list of
 * rejected field names for telemetry / debug.
 */
export function admitDiff(
  map: LwwMap,
  setId: string,
  diff: SetModifiedPayload['diff'],
  fieldTs: SetModifiedPayload['fieldTs'],
  envelopeTs: number,
): AdmitDiffResult {
  const accepted: SetModifiedPayload['diff'] = {};
  const rejected: string[] = [];

  for (const [field, value] of Object.entries(diff)) {
    if (!isKnownField(field)) continue;
    if (value === undefined) continue;

    const incomingTs = fieldTs[field] ?? envelopeTs;
    const mapKey = `${setId}:${field}`;
    const existingTs = map.ts.get(mapKey);

    if (existingTs === undefined || incomingTs > existingTs) {
      (accepted as Record<string, unknown>)[field] = value;
      map.ts.set(mapKey, incomingTs);
    } else {
      rejected.push(field);
    }
  }

  return { accepted, rejected };
}
