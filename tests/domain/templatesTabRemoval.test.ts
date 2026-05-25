/**
 * Regression guard for ADR-0024 § 1: the standalone Templates tab is
 * removed. Anything that survived would break on production navigation.
 *
 * Scans app/, components/, src/ for two failure modes:
 *   1. A file at app/(tabs)/templates.tsx (the tab screen) re-appearing.
 *   2. A `router.push('/templates')` or template literal equivalent.
 *
 * Pure node fs walk — no React, no SQLite — so it costs nothing on every run.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '..', '..');

function walk(dir: string, hits: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git') continue;
      walk(full, hits);
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      hits.push(full);
    }
  }
}

describe('Templates tab removal (ADR-0024 § 1)', () => {
  it('does not have app/(tabs)/templates.tsx anymore', () => {
    let exists = false;
    try {
      statSync(join(REPO_ROOT, 'app', '(tabs)', 'templates.tsx'));
      exists = true;
    } catch {
      // ENOENT — good, file is gone.
    }
    expect(exists).toBe(false);
  });

  it('has no router refs to the deleted /templates route', () => {
    const offending: { file: string; line: string }[] = [];
    for (const subdir of ['app', 'components', 'src']) {
      const root = join(REPO_ROOT, subdir);
      const files: string[] = [];
      walk(root, files);
      for (const file of files) {
        // Skip this very test file (it mentions the pattern in the assertion).
        if (file.endsWith('templatesTabRemoval.test.ts')) continue;
        const text = readFileSync(file, 'utf8');
        const lines = text.split('\n');
        for (const line of lines) {
          // Match router.push / router.replace / href to /templates literal.
          if (
            /router\.(push|replace|navigate)\s*\(\s*['"`]\/templates['"`]/.test(line) ||
            /href\s*=\s*['"`]\/templates['"`]/.test(line)
          ) {
            offending.push({ file: file.replace(REPO_ROOT, ''), line: line.trim() });
          }
        }
      }
    }
    expect(offending).toEqual([]);
  });
});
