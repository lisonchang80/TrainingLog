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

  // Pass 2 — groups. Walk the sorted array. Dropset HEAD consumes its
  // contiguous followers (where `parent_set_id === head.id`). Anything else
  // is a one-row group.
  const groups: SessionSetGroup[] = [];
  let i = 0;
  while (i < sorted.length) {
    const s = sorted[i];
    const isDropset = s.set_kind === 'dropset';
    const isFollower = isDropset && (s.parent_set_id ?? null) !== null;
    const isHead = isDropset && !isFollower;

    if (isHead) {
      const followers: SessionSetLayoutInput[] = [];
      const followerIndices: number[] = [];
      let j = i + 1;
      while (j < sorted.length) {
        const next = sorted[j];
        if (next.set_kind === 'dropset' && next.parent_set_id === s.id) {
          followers.push(next);
          followerIndices.push(j);
          j += 1;
        } else {
          break;
        }
      }
      groups.push({
        head: s,
        followers,
        headIndex: i,
        followerIndices,
      });
      i = j;
    } else {
      // Non-dropset row, OR orphan follower (defensive — render standalone).
      groups.push({
        head: s,
        followers: [],
        headIndex: i,
        followerIndices: [],
      });
      i += 1;
    }
  }

  return { labels, groups };
}
