export interface Session {
  id: string;
  started_at: number; // unix epoch ms
  ended_at: number | null;
  bodyweight_snapshot_kg: number | null;
  /**
   * Per-session display title (ADR-0014 + Card 11). Empty string means
   * freestyle / not set — UI shows the i18n placeholder. Populated at
   * start by `startSessionFromTemplate` (= template.name) or '' by
   * `createSession`; user can rename in-session via the tap-to-edit header.
   */
  title: string;
  /**
   * True when this session is being driven from the paired Apple Watch
   * (ADR-0019 § slice 13d Q19/Q24, v024 schema). Stored as INTEGER 0/1 in
   * SQLite; the sessionRepository adapter maps to boolean at the read
   * boundary (raw row → Session). Drives the Today tab's 5-tile vs 3-tile
   * `SessionStatsPanel` variant in `app/(tabs)/index.tsx` (slice 13d D5,
   * formerly `dev_simulate_watch_tracked`). Future write paths flip this
   * to true on Watch-initiated session start (D6) or paired-share session
   * with WC handshake ack (D7).
   */
  is_watch_tracked: boolean;
}
