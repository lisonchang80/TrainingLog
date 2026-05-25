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
}
