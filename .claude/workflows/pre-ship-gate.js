export const meta = {
  name: 'pre-ship-gate',
  description: 'Certify a consolidated branch is ready to land on main: deterministic checks (tsc/jest/lint) + perspective-diverse adversarial skeptic ensemble over the diff + a ready-to-land attestation. Run AFTER cherry-picking parallel/overnight branches into one staging state, BEFORE pushing to main. Pass {base} (default origin/main) as args to set the diff base.',
  phases: [
    { title: 'Checks', detail: 'tsc + jest + lint + changed-file inventory' },
    { title: 'Skeptics', detail: 'parallel adversarial review of the diff across dimensions' },
    { title: 'Attest', detail: 'tally blockers vs warnings -> ready-to-land verdict' },
  ],
}

const REPO = '/Users/hao800922/code/TrainingLog'
const BASE = (args && args.base) || 'origin/main'

const CHECKS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['tsc', 'jest', 'lint', 'jestSummary', 'changedFiles'],
  properties: {
    tsc: { type: 'string', enum: ['pass', 'fail'] },
    jest: { type: 'string', enum: ['pass', 'fail'] },
    lint: { type: 'string', enum: ['pass', 'fail', 'absent'] },
    jestSummary: { type: 'string' },
    changedFiles: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

const SKEPTIC_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['dimension', 'findings'],
  properties: {
    dimension: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['severity', 'file', 'issue'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'warning', 'note'] },
          file: { type: 'string' },
          issue: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

const ATTEST_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['readyToLand', 'blockers', 'warnings', 'summary'],
  properties: {
    readyToLand: { type: 'boolean' },
    blockers: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

phase('Checks')
const checks = await agent(
  `Repo: ${REPO} (cwd is repo root). You are the deterministic pre-ship checker for a consolidated branch about to land on main. Run these and report ACCURATE structured results (capture real exit codes — do not guess):
1. Changed files vs base: \`git diff --name-only ${BASE}..HEAD\`. Put the list in changedFiles.
2. \`npx tsc --noEmit\` -> tsc: 'pass' if exit 0, else 'fail'.
3. \`npx jest 2>&1 | tail -8\` -> jest: 'pass' only if 0 suites/tests failed, else 'fail'. Put the final summary line(s) in jestSummary.
4. lint: if package.json has a "lint" script, run \`npm run lint\` -> pass/fail; if there is NO lint script, report 'absent'.
Return the schema exactly.`,
  { label: 'checks', phase: 'Checks', schema: CHECKS_SCHEMA }
)

log(`tsc=${checks.tsc} jest=${checks.jest} lint=${checks.lint} | ${checks.changedFiles.length} files changed`)

const DIMENSIONS = [
  { key: 'sqlite-migration', prompt: 'SQLite / migration skeptic. If any changed file is a migration (src/db/) or repository SQL (src/adapters/sqlite/), check: idempotency guard present, CASCADE / ON DELETE SET NULL correctness on FKs, NOT NULL columns have a default or backfill, and every delete* path handles any new child FK. If NO migration/SQL files changed, return empty findings.' },
  { key: 'pure-logic', prompt: 'Pure-logic skeptic. For changed src/domain/* and src/adapters/watch/* logic: verify time is INJECTED (no Date.now()/new Date() inside pure fns), randomness/uuid injected, and any interface/shape change is reflected at ALL construction sites (repo INSERT/SELECT, test toEqual, inline literals, barrel exports). Flag shape drift.' },
  { key: 'i18n', prompt: 'i18n completeness skeptic. If src/i18n/* changed: for every REMOVED key, prove ZERO remaining callers across app/ components/ src/ (search both the bare key name AND the t(ns,key) form, including dynamic/indirect lookups). For any new user-facing English literal in changed .tsx, flag missing i18n. zh and en must stay symmetric.' },
  { key: 'rn-layout', prompt: 'RN-layout skeptic. For changed .tsx / components: grep touched files for the known gotchas — FlatList numColumns, controlled numeric TextInput buffering, Modal sheet width:100%, a new route missing its icon-symbol mapping. This is lint-level (flag suspicious patterns; note they need simulator confirmation, not in-loop proof).' },
  { key: 'cross-agent', prompt: 'Cross-agent integration skeptic. These changes were produced by SEPARATE parallel agents then consolidated, so look for integration gaps no single agent would catch: one change removes/renames something another relies on; a new module not exported from its barrel; a test or doc comment referencing a deleted path; a removed i18n key still referenced by a sibling change. Read the FULL diff.' },
]

phase('Skeptics')
const reviews = await parallel(DIMENSIONS.map(d => () =>
  agent(
    `Repo: ${REPO} (cwd is repo root). You are an ADVERSARIAL skeptic — your job is to FIND real problems, not to approve. Inspect ONLY the changes in \`git diff ${BASE}..HEAD\`. Changed files: ${JSON.stringify(checks.changedFiles)}.
${d.prompt}
Severity rules: use 'blocker' ONLY for something that would break main (failing build/test, broken caller/import, missing cascade causing orphan/runtime error). Use 'warning' for likely-but-unproven issues, 'note' for minor. If you find nothing real, return empty findings — do NOT invent issues. Always cite concrete file paths.`,
    { label: `skeptic:${d.key}`, phase: 'Skeptics', agentType: 'Explore', schema: SKEPTIC_SCHEMA }
  )
))
const valid = reviews.filter(Boolean)

phase('Attest')
const attestation = await agent(
  `Repo: ${REPO}. Produce the ready-to-land attestation for a consolidated branch (diff base ${BASE}), for a human deciding whether to push to main.
Deterministic checks: ${JSON.stringify(checks)}
Skeptic findings: ${JSON.stringify(valid)}
Rules: readyToLand=false if ANY of [tsc=fail, jest=fail, lint=fail, or any skeptic finding with severity 'blocker']. Warnings and notes do NOT block landing but must be listed. Write a crisp summary (what changed, what passed, what to watch). Put each blocker (with its fix) in blockers[], each warning in warnings[].`,
  { label: 'attest', phase: 'Attest', schema: ATTEST_SCHEMA }
)

return { checks, attestation }
