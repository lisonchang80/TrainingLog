---
name: i18n-english-leak-audit
description: Find Chinese (漢字) leaking into the ENGLISH locale after the app is switched to English — the "切英文還是中文 / 全部 ⓘ 也要英文版 / English-completeness pass before App Store" request. Distinct from i18n-sweep-alerts (that finds hardcoded English NOT going through t()). Covers TWO string surfaces with different structure: coach/help content (components/help/content/*.ts, bilingual-literal {zh,en} per file, NOT in strings.ts) and src/i18n/strings.ts (one {zh:{...},en:{...}}, with Chinese-KEYED enum maps). Key trap: Han in a KEY is fine, Han in a VALUE is the leak; naive scan-to-EOF over-catches later-export zh blocks + `const …Zh` + comments. Sim-verify by toggling Settings→English and opening the ⓘ. Validated 2026-07-02 (whole app had exactly 2 leaks).
---

# i18n English-leak audit (find 殘中文 in the en locale)

Request shape: "語言改英文後 X 還是中文" / "全部 ⓘ 也要英文版" / an
English-completeness pass before App Store. This is the OPPOSITE of
`i18n-sweep-alerts` (which finds English literals bypassing `t()`). Here the app
IS bilingual; the bug is a Chinese string sitting in an `en:` **value**.

## Step 0 — is it a content bug, or a render bug? (rule out the ghost first)

The coach/help system is already locale-reactive: `usePageHelp`
(`components/help/usePageHelp.ts`) calls `useLocale()` and returns
`localized[locale]`, so any screen using it re-renders + re-reads its `en` block
on language switch. Main-app strings go through `t(ns,key)` →
`strings[currentLocale]`. **So switching to English DOES switch the ⓘ / labels**
— sim-verified live (Training coach + Library coach both English in en mode).

A "全部 ⓘ 還是中文" report is almost never a global memoization freeze — it's
one or two **incomplete translations** (Han in an en value). Don't open a
React-Compiler-memoize investigation before ruling out content leaks with the
grep below. (If a *persistent, already-mounted* tab genuinely froze, that's the
`project-traininglog-react-compiler-i18n-gotcha` case — but usePageHelp's
`useSyncExternalStore` can't be memoized away, so per-page ⓘ is safe.)

## Two surfaces, different structure

1. **Coach/help content** — `components/help/content/<pageId>.ts`, each exports
   `{ zh: {...}, en: {...} }` (bilingual-literal, deliberately NOT in
   strings.ts — see `components/help/types.ts` header comment). Gotchas:
   - some files export **view+edit** or **regular+minimal** variants → MULTIPLE
     `en:` blocks per file (e.g. `programs.ts` has view.en + edit.en);
   - minimal-variant bodies use `const <x>Zh = '…'` / `const <x>En = '…'`
     module constants (the `…Zh` is legitimately Chinese, paired with a `…En`).
2. **Main app** — `src/i18n/strings.ts`, one
   `export const strings = { zh: {…~27-1109}, en: {…~1110-EOF} }`. The
   `exercise` + `muscleGroup` namespaces inside BOTH blocks are
   **Chinese-KEYED** maps: `'臥推': 'Bench Press'` — the KEY is the DB Chinese
   name, legitimately Han; only the VALUE must be English.

## Detection — Han in a VALUE inside an en block

Use a **Han-only** regex `[一-鿿]`. Do NOT include U+FF00–FFEF: the
fullwidth `＋` and curly quotes `“”` are intentional styling (e.g. an English
body `green “＋1” adds a set` is fine — not a leak).

A naive "scan from the first `en:` to EOF for any CJK" OVER-catches — every hit
below is a FALSE positive:
- a **later export's zh block** (multi-export files: programs.ts edit.zh),
- `const <x>Zh = '中文'` source constants (paired with a `<x>En`),
- dev **comments** (`// …中文…`),
- Chinese **keys** in exercise/muscleGroup.

The real leak = a `title:/body:/heading:/caption:` (coach) or `key:` (strings)
whose **value** contains Han, inside an `en:` block.

```bash
cd /Users/hao800922/code/TrainingLog
# (A) coach content — list every text field + minimal const, per file, and eyeball
for f in components/help/content/*.ts; do
  echo "== $(basename $f) =="; grep -nE "title:|body:|heading:|caption:|const .*(Zh|En)\b" "$f"
done
# a file's en block is the SECOND {zh,en} pair per export; verify its title/body values are English,
# and that each `const …Zh` has a matching `const …En` used by the en variant.

# (B) strings.ts — value-side Han in the en block only (Chinese KEYS won't match ": '…漢字")
grep -nE "^  (zh|en):" src/i18n/strings.ts           # find the en-block start line (e.g. 1110)
awk 'NR>=1110' src/i18n/strings.ts | grep -nP ":\s*'[^']*[一-鿿]" | grep -vP '^\s*//'
# ^ misses MULTI-LINE values (key: on one line, '…value…' on the next). Cross-check:
grep -nP '[一-鿿]' src/i18n/strings.ts   # full Han-line list; in the en range, the only
#   non-comment / non-key / non-const-Zh lines are the real multi-line-value leaks (e.g. appModeHint).

# confirm exercise/muscleGroup are key-Chinese / value-English (NOT a leak):
sed -n '1820,1824p;2093,2097p' src/i18n/strings.ts   # → 'SSB深蹲': 'Safety Bar Squat' etc.
```

## Fix + verify
- Replace the leaked term with the app's canonical English. The glossary is a
  comment near `strings.ts:18` (`通用→Default`, `超級組→Superset`, `熱→W`, …).
  Match the file's quote style (coach en uses curly `“”`).
- `npx tsc --noEmit; echo $?` — string-value edits stay type-clean (exit 0).
- **Sim-verify** (`ios-simulator-smoke`): Settings → Language → **English**, then
  open the ⓘ / navigate to the fixed screen. The ⓘ button's a11y label is
  `Page help` in en (confirms the toggle took). Read the exact string via
  `ui_find_element` / the a11y tree (e.g. the Minimal-mode row reads
  `…every workout starts as Default.`). Reload JS (terminate+relaunch the
  dev-client) so the content-module edit is in the served bundle; the locale
  persists in SQLite so it comes back English after relaunch.

## Verification gotcha — LSP false type error
The IDE `<new-diagnostics>` block can surface a FALSE `t('…')` type error from
**cross-branch stale state** (e.g. `t('onboarding', …)` flagged when the
`onboarding` namespace lives on a sibling branch). Confirm with a real
`npx tsc --noEmit; echo $?` (exit 0 ⇒ no such error) before treating it as a
commit blocker — don't "fix" it by pulling in another branch's namespace.

Cross-ref: `i18n-sweep-alerts` (opposite direction — English not in `t()`),
`ios-simulator-smoke` (the Settings→English + a11y-read verify loop),
`project-traininglog-react-compiler-i18n-gotcha` (the real render-freeze case).
