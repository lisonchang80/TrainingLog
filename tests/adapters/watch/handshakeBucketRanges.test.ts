/**
 * Slice 17 hardening (2026-06-16) — `bucketRanges` projection onto the
 * Stage 1 handshake reply wire.
 *
 * NEW FILE (NOT an extension of handshake.test.ts) — slice 16 also touches
 * handshake.test.ts, so the slice-17 hardening cases live here to avoid a
 * merge conflict on land.
 *
 * What this exercises (the wire rule, ADR-0027 D5 + `wc-add-envelope-kind`
 * skill): `buildStage1Reply(..., bucketRanges)` projects the persisted
 * `BucketBoundary[]` onto `Stage1BucketRange[]`. The open-ended top bucket's
 * `max` (NULL in the domain shape) is OMITTED on the wire — never sent as
 * explicit `null` — because a `null` inside this reply-dict array would risk
 * an NSNull → WCSession reject, killing the whole handshake reply (the picker
 * lifeline). Swift decodes an absent `max` as nil = open-ended.
 *
 * Pure builder — no DB, no WC bridge — runs under `testEnvironment: node`.
 * No module-level cache is mutated here (we pass boundaries explicitly into
 * the pure builder), so no resetBucketRanges discipline is required; the
 * live-cache path is covered in handshake.test.ts.
 */

import {
  buildStage1Reply,
  type Stage1BucketRange,
  type Stage1ReplyPayload,
} from '../../../src/adapters/watch/handshake';
import type { BucketBoundary } from '../../../src/domain/pr/types';
import type { HandshakePayload } from '../../../src/adapters/watch';

const REQ: HandshakePayload = { requestId: 'req-bk-hardening', clientVersion: '17.0' };

const DEFAULT_BOUNDARIES: BucketBoundary[] = [
  { key: 'max_strength', min: 1, max: 3 },
  { key: 'strength', min: 4, max: 6 },
  { key: 'hypertrophy', min: 7, max: 10 },
  { key: 'muscle_endurance', min: 11, max: 15 },
  { key: 'endurance', min: 16, max: null },
];

/** Convenience — build a reply carrying the given boundaries. */
const replyWith = (boundaries?: BucketBoundary[]): Stage1ReplyPayload =>
  buildStage1Reply(REQ, null, [], [], undefined, boundaries);

describe('Stage 1 reply — bucketRanges wire projection (slice 17 hardening)', () => {
  // -------------------------------------------------------------------
  // NULL-max omission on the wire
  // -------------------------------------------------------------------
  describe('NULL-max omission (wire null rule)', () => {
    it('omits the `max` key on the open-ended top bucket (never explicit null)', () => {
      const ranges = replyWith(DEFAULT_BOUNDARIES).prefetch.bucketRanges!;
      const top = ranges[ranges.length - 1] as Stage1BucketRange;
      expect(top.key).toBe('endurance');
      expect(top.min).toBe(16);
      expect(top).not.toHaveProperty('max');
    });

    it('keeps `max` on every NON-top bucket (they have a finite ceiling)', () => {
      const ranges = replyWith(DEFAULT_BOUNDARIES).prefetch.bucketRanges!;
      // First 4 buckets all carry an explicit numeric max.
      for (let i = 0; i < ranges.length - 1; i++) {
        expect(ranges[i]).toHaveProperty('max');
        expect(typeof ranges[i].max).toBe('number');
      }
    });

    it('serialised reply contains no "max":null anywhere (NSNull-reject guard)', () => {
      const json = JSON.stringify(replyWith(DEFAULT_BOUNDARIES));
      expect(json).not.toContain('"max":null');
    });

    it('round-trips JSON.parse(JSON.stringify()) identical (no null / Map / Date leakage)', () => {
      const reply = replyWith(DEFAULT_BOUNDARIES);
      expect(JSON.parse(JSON.stringify(reply))).toEqual(reply);
    });

    it('omits the whole bucketRanges field when boundaries are not provided (pre-slice-17 compat)', () => {
      const reply = buildStage1Reply(REQ, null, []);
      expect(reply.prefetch.bucketRanges).toBeUndefined();
    });

    it('handles a multi-NULL-max defensive input by omitting max only where null', () => {
      // Defensive shape: a hypothetical (invalid-but-tolerated) input where a
      // middle bucket also carries a null max. The projection must omit `max`
      // wherever the source is null and keep it wherever it is numeric — it is
      // a pure field-by-field transform, not a validate-then-reject.
      const weird: BucketBoundary[] = [
        { key: 'max_strength', min: 1, max: 3 },
        { key: 'strength', min: 4, max: null }, // null in the middle
        { key: 'hypertrophy', min: 7, max: 10 },
        { key: 'muscle_endurance', min: 11, max: 15 },
        { key: 'endurance', min: 16, max: null },
      ];
      const ranges = replyWith(weird).prefetch.bucketRanges!;
      expect(ranges[1]).not.toHaveProperty('max'); // null → omitted
      expect(ranges[2]).toHaveProperty('max'); // numeric → kept
      expect(ranges[2].max).toBe(10);
      expect(JSON.stringify(ranges)).not.toContain('"max":null');
    });
  });

  // -------------------------------------------------------------------
  // ordering preserved
  // -------------------------------------------------------------------
  describe('ordering preserved', () => {
    it('keeps the canonical low→high bucket order on the wire', () => {
      const ranges = replyWith(DEFAULT_BOUNDARIES).prefetch.bucketRanges!;
      expect(ranges.map((r) => r.key)).toEqual([
        'max_strength',
        'strength',
        'hypertrophy',
        'muscle_endurance',
        'endurance',
      ]);
    });

    it('preserves the input array order verbatim (one wire entry per source entry)', () => {
      const ranges = replyWith(DEFAULT_BOUNDARIES).prefetch.bucketRanges!;
      expect(ranges).toHaveLength(DEFAULT_BOUNDARIES.length);
      ranges.forEach((r, i) => expect(r.key).toBe(DEFAULT_BOUNDARIES[i].key));
    });

    it('emits min in ascending, contiguous order matching the source boundaries', () => {
      const ranges = replyWith(DEFAULT_BOUNDARIES).prefetch.bucketRanges!;
      expect(ranges.map((r) => r.min)).toEqual([1, 4, 7, 11, 16]);
    });
  });

  // -------------------------------------------------------------------
  // edited-vs-default payload
  // -------------------------------------------------------------------
  describe('edited-vs-default payload', () => {
    it('default boundaries project to the v1 wire shape (top max omitted)', () => {
      expect(replyWith(DEFAULT_BOUNDARIES).prefetch.bucketRanges).toEqual([
        { key: 'max_strength', min: 1, max: 3 },
        { key: 'strength', min: 4, max: 6 },
        { key: 'hypertrophy', min: 7, max: 10 },
        { key: 'muscle_endurance', min: 11, max: 15 },
        { key: 'endurance', min: 16 },
      ]);
    });

    it('carries USER-EDITED ranges verbatim so Watch labels match the phone', () => {
      const edited: BucketBoundary[] = [
        { key: 'max_strength', min: 1, max: 5 }, // widened
        { key: 'strength', min: 6, max: 9 },
        { key: 'hypertrophy', min: 10, max: 14 },
        { key: 'muscle_endurance', min: 15, max: 25 },
        { key: 'endurance', min: 26, max: null }, // shifted-up open-ended top
      ];
      expect(replyWith(edited).prefetch.bucketRanges).toEqual([
        { key: 'max_strength', min: 1, max: 5 },
        { key: 'strength', min: 6, max: 9 },
        { key: 'hypertrophy', min: 10, max: 14 },
        { key: 'muscle_endurance', min: 15, max: 25 },
        { key: 'endurance', min: 26 },
      ]);
    });

    it('edited vs default produce DIFFERENT wire payloads (the edit actually propagates)', () => {
      const edited: BucketBoundary[] = [
        { key: 'max_strength', min: 1, max: 2 },
        { key: 'strength', min: 3, max: 5 },
        { key: 'hypertrophy', min: 6, max: 12 },
        { key: 'muscle_endurance', min: 13, max: 20 },
        { key: 'endurance', min: 21, max: null },
      ];
      const defaultJson = JSON.stringify(replyWith(DEFAULT_BOUNDARIES).prefetch.bucketRanges);
      const editedJson = JSON.stringify(replyWith(edited).prefetch.bucketRanges);
      expect(editedJson).not.toBe(defaultJson);
      // And the edited 增肌 ceiling (12) is on the wire, not the default (10).
      expect(replyWith(edited).prefetch.bucketRanges![2]).toEqual({
        key: 'hypertrophy',
        min: 6,
        max: 12,
      });
    });

    it('an empty boundaries list projects to an empty (but present) wire array', () => {
      // `[]` is "explicitly send an empty list" (distinct from undefined =
      // omit the field). The builder still attaches an empty array.
      const reply = buildStage1Reply(REQ, null, [], [], undefined, []);
      expect(reply.prefetch.bucketRanges).toEqual([]);
    });

    it('bucketRanges ride alongside the present-session variant of the reply', () => {
      const reply = buildStage1Reply(
        REQ,
        { sessionId: 's1', startedAt: 1, title: 'X', exerciseCount: 2 },
        [],
        [],
        undefined,
        DEFAULT_BOUNDARIES,
      );
      expect(reply.hasActiveSession).toBe(true);
      expect(reply.prefetch.bucketRanges).toHaveLength(5);
      expect(reply.prefetch.bucketRanges![4]).not.toHaveProperty('max');
    });
  });
});
