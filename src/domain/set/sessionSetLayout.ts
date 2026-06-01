/**
 * Session set layout — slice 10c overnight #61.
 *
 * Combines two responsibilities for the active session + session detail
 * edit-mode rendering:
 *
 *   1. **Display labels** — '熱' / '{N}' / 'D{N}' / ''  per set id.
 *      Mirrors the template editor's `computeExMeta` (template-editor-view.tsx
 *      lines 1957-1989): dropset HEADs get `D{N}` where N is the 1-based
 *      dropset cluster index among dropset HEADS in this exercise; followers
 *      get empty string (no per-row label — the row visually attaches to
 *      its head). Warmup → '熱'; working → 1-based ordinal among working
 *      sets only (warmup / dropset rows don't consume the working counter).
 *
 *   2. **Render groups** — each "swipe unit" the UI iterates. A non-dropset
 *      row becomes a single-row group; a dropset HEAD plus all of its
 *      followers becomes ONE group so head + followers travel together
 *      under a single `<SwipeableSetRow>` (mirror template editor
 *      `template-editor-view.tsx` lines 2197-2237 cluster-stack pattern).
 *
 * Why a single helper for both: the active session render needs labels AND
 * group structure each render; computing them once together avoids two
 * passes over the same sorted array and keeps the contract atomic
 * (label-to-group invariants stay in lockstep — e.g. follower index used
 * for label lookup matches the same array index used when collecting the
 * follower into its group).
 *
 * Why NOT extend `workingSetOrdinal.displaySetLabel`: that helper
 * deliberately collapses dropset → `'D'` for cluster cards (space-
 * constrained, see workingSetOrdinal.ts header doc). Active session solo
 * cards have more room and the spec asks for `D{N}` here. We leave
 * `displaySetLabel` untouched so `cluster-card.tsx` keeps its 'D'
 * single-char marker. Only the solo-card render paths in
 * `app/(tabs)/index.tsx` and `app/session/[id].tsx` switch to this new
 * helper.
 *
 * Why NOT reuse `historySetLabel.computeHistorySetLabels`: that helper
 * counts EVERY dropset row (head AND follower) toward the D-counter so
 * history shows `D1, D2, D3, …` per row (one chain might span D1+D2+D3
 * etc). Active session shows ONE D-label per chain (head only, follower
 * blank) so the chain visually reads as a single unit. Different display
 * intent, separate helper.
 *
 * Defensive behaviour: an orphan follower (`set_kind = 'dropset'`,
 * `parent_set_id` set to a non-existent head) is treated as its own
 * standalone group with empty label — never silently dropped. This shouldn't
 * happen via UI but DB drift / partial deletes could leave one behind.
 */

export interface SessionSetLayoutInput {
  id: string;
  set_kind: 'warmup' | 'working' | 'dropset';
  parent_set_id: string | null;
  ordering: number;
}

interface SessionSetGroup {
  /** The head row — anchor for swipe gestures + ✓ button. */
  head: SessionSetLayoutInput;
  /** Follower rows (only populated for dropset chains; empty otherwise). */
  followers: SessionSetLayoutInput[];
  /** Index of `head` in the (sorted) input array. */
  headIndex: number;
  /** Indices of `followers` in the (sorted) input array, parallel to followers[]. */
  followerIndices: number[];
}

interface SessionSetLayout {
  /** id → display label ('熱' / '1' / 'D1' / '' / …). */
  labels: Map<string, string>;
  /** Groups in sorted ordering. */
  groups: SessionSetGroup[];
}

/**
 * Build labels + groups for one exercise's session sets. Sort-by-ordering
 * is internal; the input array can be in any order.
 */
export function computeSessionSetLayout(
  sets: ReadonlyArray<SessionSetLayoutInput>,
): SessionSetLayout {
  const sorted = [...sets].sort((a, b) => a.ordering - b.ordering);

  // Pass 1 — labels. Mirror template editor's computeExMeta exactly:
  // warmup → 熱; dropset HEAD → D{clusterIdx++}; dropset follower → '';
  // working → workIdx++.
  const labels = new Map<string, string>();
  let workIdx = 0;
  let clusterIdx = 0;
  for (const s of sorted) {
    if (s.set_kind === 'warmup') {
      labels.set(s.id, '熱');
    } else if (s.set_kind === 'dropset') {
      if ((s.parent_set_id ?? null) === null) {
        clusterIdx += 1;
        labels.set(s.id, `D${clusterIdx}`);
      } else {
        labels.set(s.id, '');
      }
    } else {
      // working
      workIdx += 1;
      labels.set(s.id, String(workIdx));
    }
  }

  // Pass 2 — groups. A dropset HEAD gathers ALL of its followers
  // (`parent_set_id === head.id`) wherever they sit in the sorted order — NOT
  // only the ones contiguous after it. This is what makes the cluster fold
  // correctly even when a follower's `ordering` lands PAST a later working set:
  // the WC live mirror emits a Watch-added follower at ordinal `max+1`, so it
  // cannot always be contiguous with its head (a mid-list head + a later base
  // set would otherwise strand the follower as an orphan). See ADR-0019 §
  // 2026-06-01 (遞減組 reconcile). The cluster renders as ONE group at the
  // HEAD's sorted position; gathered followers are skipped when reached.
  //
  // Order-independent: gather first (head.id → follower sorted-indices, marking
  // them consumed), then walk. A follower whose head is PRESENT is never
  // emitted standalone; a TRUE orphan (head absent, never consumed) still
  // renders standalone (defensive — DB drift / partial deletes).
  const headIds = new Set<string>();
  for (const s of sorted) {
    if (s.set_kind === 'dropset' && (s.parent_set_id ?? null) === null) {
      headIds.add(s.id);
    }
  }
  const followersByHead = new Map<string, number[]>(); // head.id → sorted follower indices (ascending)
  const consumed = new Set<number>();
  for (let k = 0; k < sorted.length; k += 1) {
    const s = sorted[k];
    const parent = s.parent_set_id ?? null;
    if (s.set_kind === 'dropset' && parent !== null && headIds.has(parent)) {
      const list = followersByHead.get(parent);
      if (list) list.push(k);
      else followersByHead.set(parent, [k]);
      consumed.add(k);
    }
  }

  const groups: SessionSetGroup[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    if (consumed.has(i)) continue;
    const s = sorted[i];
    if (s.set_kind === 'dropset' && (s.parent_set_id ?? null) === null) {
      const idxs = followersByHead.get(s.id) ?? [];
      groups.push({
        head: s,
        followers: idxs.map((j) => sorted[j]),
        headIndex: i,
        followerIndices: idxs,
      });
    } else {
      // Non-dropset row, OR a TRUE orphan follower (head absent — not
      // consumed above) — render standalone.
      groups.push({
        head: s,
        followers: [],
        headIndex: i,
        followerIndices: [],
      });
    }
  }

  return { labels, groups };
}
