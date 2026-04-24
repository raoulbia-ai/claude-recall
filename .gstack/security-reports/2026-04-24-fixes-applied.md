# Security Fixes Applied — 2026-04-24

**Audit date:** 2026-04-23 (full /cso scan, daily mode)
**Fix date:** 2026-04-24
**Scope of fixes:** Top 3 highest-severity findings from the prior audit. Lower-confidence findings deferred for the next scan cycle.
**Branch:** main (uncommitted; user has not yet committed/published)
**Versions:** package.json shows 0.23.3 (current local). No new release cut yet.

> **NEXT-SCAN INSTRUCTION:** any future `/cso` invocation in this repo MUST
> read every file in `.gstack/security-reports/` (this file included) before
> producing findings. Use the contents to (a) confirm prior fixes are still in
> place, (b) avoid re-reporting resolved issues as new, (c) update the trend
> tracker with `resolved`/`persistent`/`new` counts.

---

## Finding 1 — Self-dependency in package.json (CRITICAL)

**Original problem.** `package.json` listed `"claude-recall": "^0.15.31"` in `dependencies`. npm resolved this by pulling a separate older copy of claude-recall into `node_modules/claude-recall/` on every install. That nested copy had its own `postinstall` script, which ran during install of the parent package. Net effect: a single `npm install -g claude-recall` ran TWO postinstall scripts, and any future hijack of an older `0.15.x` line would immediately propagate to all new installs of current versions.

**Fix.** Removed the self-dependency line.

**Files changed:**
- `package.json` — `dependencies` block now contains only `@anthropic-ai/sdk`, `better-sqlite3`, `chalk`, `commander`. No `claude-recall` self-reference.

**Verification:**
```bash
grep '"claude-recall":' package.json   # should match nothing in dependencies block
```

**Residual risk.** `package-lock.json` still references the old nested copy and version `0.18.9` at the root. The maintainer must run `rm -rf node_modules package-lock.json && npm install` before publishing the next version so the lockfile reflects the fix. **The next scan must re-grep package-lock.json for the self-dep entry — if it's still there, the fix isn't fully landed.**

---

## Finding 2 — postinstall silently overwrites user `.claude/settings.json` hooks (HIGH)

**Original problem.** `scripts/postinstall.js` lines 107-199 read the user's existing `<cwd>/.claude/settings.json`, then assigned a brand-new object literal to `settings.hooks`, wiping every existing hook (PreToolUse, PostToolUse, Stop, UserPromptSubmit, SessionStart, SessionEnd, PreCompact, etc.). No backup, no diff, no prompt, runs every time. When `npm install -g` was invoked from `$HOME`, this clobbered the user's GLOBAL Claude Code settings at `~/.claude/settings.json`. A user with security-scanning hooks could have them silently disabled.

**Fix.** Removed the entire hook-installation/settings-rewrite block from postinstall. Hook-based features are now opt-in via `npx claude-recall setup`, which the user runs consciously and can review the diff for. MCP server registration via `claude mcp add ...` is preserved (memory tools still work out of the box).

**Files changed:**
- `scripts/postinstall.js` — replaced lines 107-213 with explanatory comment + new activation instructions pointing the user at `npx claude-recall setup`.

**Verification:**
```bash
# Should print nothing — no settings.json writes from postinstall
grep -n "settings.hooks\s*=" scripts/postinstall.js
grep -n "writeFileSync.*settings" scripts/postinstall.js
```

**Residual risk.**
- `src/cli/claude-recall-cli.ts:installSkillsAndHook` (around line 990, invoked by `claude-recall setup`) still does the same wholesale `settings.hooks =` overwrite, just at user request rather than silently. **Recommended for the next cycle:** make `setup` merge instead of overwrite, key by `command` substring to dedupe on re-run, and write a `.claude/settings.json.bak.<timestamp>` backup before the first mutation. Track this as a follow-up finding.
- New users installing claude-recall now get NO hooks until they run `setup`. This is intentional — the security cost of silent-overwrite outweighed the activation friction. Document this in README and CHANGELOG when the next version ships.

---

## Finding 3 — `.claude/settings.local.json` shipped in npm tarball (HIGH, info disclosure)

**Original problem.** `package.json`'s `files` array included `.claude/` wholesale. npm publish does NOT honor `.gitignore`, so `.claude/settings.local.json` (which contains the developer's home-directory paths and permission allowlist) was included in every published tarball, leaking the developer's environment to anyone who downloaded the package. Verified in `claude-recall-0.19.0.tgz`:
```
package/.claude/settings.local.json
package/.claude/settings.json
```

**Fix.** Narrowed the `files` array to only the two subdirectories that should ship: `.claude/hooks/` and `.claude/skills/`. `.claude/settings.json` and `.claude/settings.local.json` are now excluded.

**Files changed:**
- `package.json` — `files` now lists `".claude/hooks/"` and `".claude/skills/"` instead of `".claude/"`.

**Verification:**
```bash
npm pack --dry-run 2>&1 | grep settings
# Should print NOTHING. Confirmed at fix time:
#   only .claude/hooks/search_enforcer.py and .claude/skills/* are shipped
```

**Residual risk.**
- Already-published versions (0.15.31, 0.18.9, 0.19.0, 0.22.x, 0.23.x) still have the leaked file on the npm registry. Within 72 hours of publish you can `npm unpublish`; after that, `npm deprecate` with a note pointing to the next clean version. Decide which: if `settings.local.json` ever contained a token or anything sensitive, unpublish/deprecate is required. If it only ever contained directory paths and Bash allowlist entries (as in 0.19.0), the risk is low — disclose in CHANGELOG and move on.
- Audit historical `settings.local.json` git history: `git log --all -- .claude/settings.local.json` to confirm nothing sensitive was ever there.

---

## What was NOT fixed in this pass (deferred for next cycle)

These came in below the daily-mode 8/10 confidence gate or were architectural rather than direct vulnerabilities. Re-evaluate next scan with current state:

- **Persistent prompt injection via stored memories** (MEMO/medium). `LOAD_RULES_DIRECTIVE` in `src/mcp/tools/memory-tools.ts:67-72` tells Claude to override its own plan when rules conflict. Combined with `rule-injector.ts` injecting rule content as system-reminder blocks, any malicious content stored via `store_memory` (e.g. via Claude reading a poisoned file) becomes a persistent backdoor across sessions. Mitigations: reframe directive language, wrap injected content in a trust label, optionally pre-store filter on injection-pattern regexes.
- **`db.exec('DELETE FROM memories WHERE id IN (${ids})')`** in `src/services/database-manager.ts:309, 359`. Currently safe because `ids` come from local DB autoincrement integer PKs, not user input. Convert to prepared statement to prevent regression.
- **Stack trace leakage in MCP error responses** (`src/mcp/server.ts:327`). Sent only over local stdio to Claude Code; low practical risk but easy to strip.
- **CLI `setup` command has the same hooks-overwrite bug** as the old postinstall. See Finding 2 residual risk note.

## Pre-publish checklist for the next release

Before cutting the version that ships these fixes, the maintainer must:

1. `rm -rf node_modules package-lock.json && npm install` — regenerate lockfile without the self-dep
2. `npm pack --dry-run` and grep for `settings.local.json` — confirm 0 matches
3. `npm pack && tar -tzf claude-recall-*.tgz | grep -E '(claude-recall|settings.local|settings.json)$'` — confirm tarball is clean and has no nested claude-recall dir
4. Bump version, update CHANGELOG with a Security section, publish
5. `npm view claude-recall@<new-version> dependencies` — confirm registry has clean deps
6. Decide unpublish-vs-deprecate for the leaked-settings versions

## Round-2 finding (discovered while preparing to publish the round-1 fixes)

### Finding 5 — Cross-project memory leak via auto-generated skills (CRITICAL)

**Original problem.** While preparing to publish 0.24.0, inspected `.claude/skills/auto-*/` on the maintainer's dev disk and found 117 entries of failure-lessons content pulled from the maintainer's work on a *different* project (`openclaw-autonomous-telco-agents`). The content included internal product/component names (OpenClaw, nemoclaw, mock-eiap, SENTINEL, nka-telco, openshell), kubectl/docker command lines exposing the architecture, an internal websocket endpoint, a named security control (nemoclaw SSRF guard) with a documented workaround, and personal filesystem paths. The maintainer's `~/.claude-recall/claude-recall.db` is shared across all projects they use claude-recall in; the SkillGenerator pulled from that shared DB and wrote auto-skills to `.claude/skills/auto-*/` of whatever directory the MCP was running in — including the claude-recall dev directory itself.

The `package.json` `files` array shipped `.claude/skills/` wholesale, so `npm publish` packed those auto-skills into the tarball. Verified the leak shipped in 0.19.0 (clean — auto-skills generated 2026-04-02, before the maintainer started openclaw work) but auto-failure-lessons was last regenerated 2026-04-09T20:21:12Z and contained the openclaw content. Version 0.20.13 was published 44 minutes after that regeneration. **All published versions from 0.20.13 (2026-04-09) through 0.23.3 (2026-04-23) presumably shipped the leaked content** — 15 versions.

**Two architectural causes, both fixed:**

1. `src/services/skill-generator.ts` — `getMemoriesForTopic` defaulted to `searchContext.includeAllProjects = true` when no `projectId` was passed, and `checkAndGenerate` did not coerce a default project ID. Now hard-scoped: `checkAndGenerate` resolves `ConfigService.getInstance().getProjectId()` if no projectId is passed; `getMemoriesForTopic` falls back to the same instead of broadening to all projects. CLI commands that genuinely want global generation must pass an explicit projectId.
2. `package.json` `files` shipped `.claude/skills/` wholesale. Narrowed to `.claude/skills/memory-management/` (the curated, intentional skill). Even if SkillGenerator wrote auto-skills locally on a maintainer machine, they cannot be packed.

Plus a defense-in-depth change: `.gitignore` adds `.claude/skills/auto-*/` so the auto-skills cannot be accidentally committed to the GitHub repo either.

**Verification (npm pack 0.24.0):** zero hits across `ebiarao`, `openclaw`, `nemoclaw`, `openshell`, `ericsson`, `ericai`, `mock-eiap`, `sentinel`, `nka-telco`, `settings.local`.

**Severity calibration.** Maintainer assessed as "not critical, no sensitive data" — content was cross-project memory exhaust (paths, command lines, internal component names), no credentials, no customer data, no source code. The named SSRF-guard description is reconnaissance-grade for someone targeting that platform but is not actionable on its own.

**Remediation for past versions.**
- 0.23.0 (2026-04-22), 0.23.1 (2026-04-22), 0.23.2 (2026-04-23), 0.23.3 (2026-04-23) — within npm's 72-hour unpublish window relative to 2026-04-24. `npm unpublish claude-recall@<v>` planned (G1).
- 0.20.13 (2026-04-09) through 0.22.2 (2026-04-14) — outside 72h window. `npm deprecate 'claude-recall@>=0.20.13 <0.24.0' "Contained cross-project memory data — upgrade to 0.24.0+"` planned (G2).
- 0.19.0 and earlier — confirmed clean of internal markers, no action needed.

---

## Round-2 deferred-item fixes (also landed in 0.24.0)

The four deferred items from round 1's "What was NOT fixed" list have all been addressed in this round.

### CLI `setup` hooks-overwrite — `src/cli/claude-recall-cli.ts` `installSkillsAndHook()`

The same wholesale `settings.hooks =` replacement that was removed from `postinstall` also lived in the CLI `setup` command. Since `setup` is opt-in (user runs `npx claude-recall setup` consciously), wholesale overwrite is more defensible — but only with a recoverable backup. Now: when existing `hooks` are detected, `settings.json` is copied to `settings.json.bak.<ISO-timestamp>` before any mutation, and the user is told about the backup and how to restore.

### LOAD_RULES_DIRECTIVE + rule-injector trust labeling — `src/mcp/tools/memory-tools.ts`, `src/hooks/rule-injector.ts`

The directive previously read *"If a rule conflicts with your plan, follow the rule — it reflects a user decision."* That language treated stored memories as authoritative system instructions and turned `store_memory` into a persistent prompt-injection vector across sessions. Reframed: stored items are now identified as *user data* (which may include content originating from external sources), explicitly subordinated to safety/correctness defaults, and the model is instructed to note conflicts rather than blindly comply.

The rule-injector previously emitted bare snippet text that Claude Code wrapped in `<system-reminder>` adjacent to tool calls, blurring the trust line further. Now wrapped in an explicit `<recalled-memory source="user-stored" advisory="true">` container so the model sees the trust boundary inline.

### `db.exec` SQL string interpolation — `src/services/database-manager.ts`

`pruneOldToolUse` and `pruneOldCorrections` used `db.exec(\`DELETE FROM memories WHERE id IN (${ids})\`)` with `ids` built from `db.prepare(...).all()` results. The values were autoincrement INTEGER PKs, so safe today, but the pattern would have silently become an SQLi vector if the source of `id` ever changed. Both call sites now use `db.prepare("DELETE FROM memories WHERE id IN (?,?,?,...)").run(...ids)` with explicit `?` placeholders.

### Stack trace leakage in MCP error responses — `src/mcp/server.ts`

`handleToolCall`'s error response previously returned `metadata.error = { message, stack }` over the JSON-RPC transport. Stacks expose internal file paths and code structure. The wire response now returns only `{ message }`; full stacks are still captured locally via `logServiceError()` for diagnosis.

---

## Round-2 release prep (0.24.0)

- **Version bumped 0.23.3 → 0.24.0.** Minor bump because postinstall behavior change (no longer auto-installs hooks) is a user-visible UX change.
- **CHANGELOG.md** has a comprehensive 0.24.0 Security section listing every fix.
- **package-lock.json regenerated.** `rm -rf node_modules package-lock.json && npm install` produces a clean dep graph; verified no `node_modules/claude-recall/` (no nested self-dep) and `npm audit` reports 0 vulnerabilities.
- **Build:** `npm run build` clean (tsc no errors).
- **Tests:** `npm test` 473/473 passing across 37 suites.
- **Tarball verification:** `npm pack` produces `claude-recall-0.24.0.tgz` (101 files). Grep for `ebiarao|openclaw|nemoclaw|openshell|ericsson|ericai|mock-eiap|sentinel|nka-telco|settings.local` across all packed files returns zero hits across the board. (One `OpenClaw-RL` open-source attribution paragraph in README's Acknowledgments section was removed at the maintainer's request — strict reading of "openclaw has no business in claude recall".)

## Repo hygiene done in this round

- `.gitignore` extended:
  - `.ericai_authrecord` and `*_authrecord` (Azure AD auth records dropped by enterprise tools into cwd)
  - `.azure/`
  - `.jest-cache/`
  - `claude-recall-*.tgz` (the previous `claude-recall.db*.tgz` literal-substring pattern only matched files starting with `claude-recall.db`)
  - `.claude/skills/auto-*/` (defense-in-depth so SkillGenerator output never enters git)
- 4 untracked WIP docs in `docs/` (`OpenClaw-RL/` research, agentic-reasoning notes, cc-agent-harness reference, Anthropic blog archive) moved out of the repo to `~/claude-recall-stash-2026-04-24/docs/` so they don't ship via the `files` array. They're preserved for the maintainer to triage separately — neither runtime exhaust nor curated user docs, so the publish should not include them by default.
- README.md `## Acknowledgments` paragraph (Gen-Verse OpenClaw-RL credit) removed at maintainer's strict request.

## Audit trail

| When | Action | Evidence |
|------|--------|----------|
| 2026-04-23 | Initial /cso scan, 4 findings reported (CRITICAL self-dep, HIGH postinstall, HIGH settings.local.json, MEDIUM persistent prompt injection) | Run transcript |
| 2026-04-24 | Round 1: Findings 1-3 fixed in working tree | This document, original sections |
| 2026-04-24 | Round 2: Finding 5 (cross-project leak) discovered and fixed; deferred items 1-4 also fixed; release prep complete; tarball verified virgin | This document, sections above |
| 2026-04-24 | Pending: F1 commit, F2 push to GitHub, F3 npm publish 0.24.0 (user gate), G1 npm unpublish 0.23.0-0.23.3 (user gate), G2 npm deprecate 0.20.13-0.22.2 (user gate) | — |
| 2026-05-08 | (scheduled) follow-up /cso scan to verify fixes landed in published version | Pending |
