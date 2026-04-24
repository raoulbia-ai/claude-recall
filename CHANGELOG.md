# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`claude-recall repair` is now a conservative hook-path fixer by default, runnable on any machine.** Motivated by a real stale-hook failure on a user's VM where `~/.claude/settings.json` pointed at `/home/USER/node_modules/claude-recall/dist/cli/claude-recall-cli.js` — a path that no longer existed, so every `Stop` / `UserPromptSubmit` / `PreCompact` hook threw `MODULE_NOT_FOUND`. Running `claude-recall repair` now:
  - Scans user-global (`~/.claude/settings.json` + `settings.local.json`) and the closest project (`.claude/settings.json`) settings files.
  - Finds hooks whose commands reference claude-recall but point at a missing absolute script path.
  - If `claude-recall` is on PATH, rewrites those commands to the portable `claude-recall hook run <id>` form — preserving each hook's `timeout`, each group's `matcher`, and every sibling (non-claude-recall) hook verbatim. If `claude-recall` is not on PATH, reports the issue and exits 0 with install instructions.
  - Writes a `<path>.bak.<iso-timestamp>` before any mutation.
  - **Does not touch `hooksVersion`, does not re-install missing hooks, and does not rewrite non-claude-recall hooks.**
  - New flags: `--auto` (non-interactive), `--dry-run` (report only), `--scope user|project|all`, `--reinstall-hooks` (legacy opinionated path that rewrites the whole block from the current template; `--force` kept as an alias for backwards compatibility).
- **`postinstall` now runs `claude-recall repair --auto --scope user` on upgrade.** Self-heals the common "global claude-recall moved/renamed and left stale hook commands in `~/.claude/settings.json`" failure without ever installing hooks where none exist (which would repeat the 0.24.0 clobber bug). Non-fatal if it errors — `npm install` always succeeds.

## [0.24.2] - 2026-04-24

### Fixed

- **`claude-recall upgrade` now scans for stale local installs even when already up-to-date.** 0.24.1 added the scan but only ran it after a successful upgrade — users on the latest version had no way to invoke just the diagnostic. Now the scan runs on every `claude-recall upgrade` invocation regardless of whether a version change happened, so:
  - `claude-recall upgrade` on an outdated global → upgrades + scans (as before)
  - `claude-recall upgrade` on a current global → scans only (now acts as a diagnostic)
  - `claude-recall upgrade --clean-locals` → always scans, auto-removes anything found, works even with no upgrade pending

  Note: this also addresses the chicken-and-egg from 0.24.0 → 0.24.1 — users who upgraded with the old 0.24.0 binary never saw the scan run, because the running process didn't have the new code. Re-running `claude-recall upgrade` on 0.24.2+ from the same machine now invokes the scan whether or not an install is needed.

## [0.24.1] - 2026-04-24

### Fixed

- **`claude-recall upgrade` now detects stale project-local installs** that shadow the just-upgraded global binary. After running `npm install -g`, walks from cwd up to `$HOME` (and explicitly checks `$HOME/node_modules/`) looking for `node_modules/claude-recall/`. For each one found, prints the path, the version, and a drift indicator. By default it just warns and prints copy-paste `rm` commands; pass `--clean-locals` to auto-remove.

  Why this matters: `npx claude-recall` walks UP the directory tree from cwd looking for `node_modules/.bin/claude-recall` and uses the first match — not the global install. A stray `~/node_modules/claude-recall/` (a common WSL/Windows accident, or leftover from a one-off `npm install` somewhere) traps every `npx claude-recall` invocation under `$HOME` and silently runs an old version. After upgrading globally, users had no obvious way to know this until they noticed a feature missing.

  The walk stops at `$HOME` so global installs (under `/lib/node_modules/`, `/.nvm/`, `/usr/local/`, etc.) are never reported or touched.

## [0.24.0] - 2026-04-24

### Security

A 2026-04-23 internal audit found that earlier published versions of this package shipped artifacts produced by the maintainer's own runtime use of claude-recall. This release closes the architectural causes and ensures published tarballs contain only the product itself, not runtime exhaust.

- **Cross-project memory leak via auto-generated skills.** The `SkillGenerator` defaulted to `includeAllProjects = true` when no `projectId` was passed, which combined with the package shipping `.claude/skills/` wholesale caused memories from the maintainer's other projects (paths, command lines, internal product/component names) to land in the npm tarball. Every `npm publish` since 2026-04-09 in which auto-skills had been (re)generated on the publishing machine was affected. Fix:
  - `SkillGenerator.checkAndGenerate` and `getMemoriesForTopic` now hard-scope to the current project (`ConfigService.getProjectId()`) — never broaden to all projects implicitly. CLI commands that genuinely want global generation must pass an explicit `projectId`.
  - `package.json` `files` narrowed from `.claude/skills/` to `.claude/skills/memory-management/` so even if auto-skills are written to disk on a maintainer machine they cannot be packed.
  - `.gitignore` adds `.claude/skills/auto-*/` to prevent accidental commits.
- **Self-dependency removed.** `dependencies` previously listed `claude-recall: ^0.15.31`, causing `npm install -g claude-recall` to also pull a separate older copy of itself into `node_modules/claude-recall/`. That older copy ran its own `postinstall`, doubled the supply-chain attack surface, and would have auto-installed any malicious 0.15.x version published later. Removed.
- **`postinstall` no longer overwrites `.claude/settings.json`.** The previous postinstall read the user's `<cwd>/.claude/settings.json`, then assigned a brand-new object to `settings.hooks`, silently destroying any other `PreToolUse` / `PostToolUse` / `Stop` / `UserPromptSubmit` / `SessionEnd` / `PreCompact` hooks the user had configured (including security tooling). When `npm install -g` was run from `$HOME` it clobbered the user's GLOBAL Claude Code settings. The postinstall now registers the MCP server only and prints activation instructions; hook installation is opt-in via `npx claude-recall setup`.
- **`.claude/settings.local.json` no longer ships in the npm tarball.** The previous `files` entry `.claude/` packed the maintainer's local-settings file (which `.gitignore` correctly excluded but `npm publish` does not honor). This leaked the maintainer's home-directory paths and Bash permission allowlist. The new `files` entry is explicit (`hooks/`, `skills/memory-management/`).
- **`claude-recall setup` now backs up `settings.json` before mutating it.** Opt-in invocation, but the wholesale `settings.hooks =` replacement could still surprise users who had hooks from other tools. A timestamped `.bak` is written first when existing hooks are detected.
- **`load_rules` and rule-injector reframed as advisory user-data, not authoritative system instructions.** The directive previously told the model "If a rule conflicts with your plan, follow the rule — it reflects a user decision," and the rule-injector emitted bare snippets that Claude Code wraps in `<system-reminder>`. Combined, this turned any content that reached `store_memory` (including content captured from files or web pages the model read) into a persistent prompt-injection vector across sessions. The directive now explicitly identifies stored items as user data subject to safety/correctness defaults, and rule-injector wraps content in `<recalled-memory source="user-stored" advisory="true">`.
- **`DELETE FROM memories WHERE id IN (...)` now uses prepared statements** in `database-manager.ts`. The previous string-interpolation form was safe in current usage (ids come from local autoincrement INTEGER PKs) but would have silently become an SQL-injection vector if `id` ever became externally controlled.
- **MCP error responses no longer include the JavaScript stack trace.** Stacks leak file paths and code structure to the wire. Local diagnosis still has full stacks via `logServiceError()`.

### Breaking

- **Hook activation is now opt-in via `npx claude-recall setup`.** New installs no longer auto-write `.claude/settings.json` from `npm install`. Memory tools (load_rules, store_memory, search_memory, delete_memory, save_checkpoint, load_checkpoint) work out of the box via the MCP server registration. Hook-based features (auto-capture from user prompts, search enforcement, just-in-time rule injection, post-tool failure capture) require the explicit `setup` command. This is a one-time step per project where you want hooks active.

### Maintenance

- `.gitignore` updated to cover known gaps: `.ericai_authrecord` (and `*_authrecord`), `.jest-cache/`, `claude-recall-*.tgz` (the previous `claude-recall.db*.tgz` pattern only matched a literal `.db` substring).
- Audit log committed at `.gstack/security-reports/2026-04-24-fixes-applied.md`.

### Note on previously published versions

Versions 0.20.13 through 0.23.3 were published with auto-skills bundled. Versions still inside the 72-hour npm unpublish window will be unpublished; older versions will be deprecated with a pointer to 0.24.0. The leaked content was cross-project memory data (file paths, command-line history, internal component names) — no credentials, no customer data, no source code from the originating projects.

## [0.23.3] - 2026-04-23

### Changed

- **README upgrade instructions** now cover the pre-0.23.2 bootstrap case. Users on older versions who run `claude-recall upgrade` hit `error: unknown command 'upgrade'` — the section now explicitly says to bootstrap once with `npm install -g claude-recall@latest`, then future upgrades use `claude-recall upgrade`.
- The EACCES details block now includes the missing `npm install -g claude-recall@latest` step inside the permanent-prefix-fix recipe. Previously the block jumped straight from `source ~/.bashrc` to `claude-recall upgrade`, which fails when the old binary is still on PATH — the prefix fix only changes *where* npm installs, not what is installed.

## [0.23.2] - 2026-04-23

### Added

- **`claude-recall upgrade` command.** One-shot upgrade path: checks the npm registry, runs `npm install -g claude-recall@latest`, then clears any running MCP servers so Claude Code respawns them with the new binary on the next tool call. No need to re-run `claude mcp add` — existing registrations point at the `claude-recall` command name, not a pinned path, so they pick up the new binary automatically.
- On `EACCES: permission denied`, the command prints both remediation paths inline (one-time `sudo`, or the permanent user-owned `~/.npm-global` prefix fix) so users don't have to go hunting for a solution.

### Changed

- **README install & upgrade instructions rewritten** for clarity. The Upgrading section collapses from three conditional sub-sections into a single `claude-recall upgrade` command plus an optional collapsible block for the EACCES case. Install section adds an inline note for the same error.

## [0.23.1] - 2026-04-22

### Fixed

- **`search_enforcer` no longer blocks read-only exploration before `load_rules`** (#10). On session start, tools like `Read`, `Glob`, and `Grep` previously hit the "LOAD RULES REQUIRED" gate, adding 1–3 blocked calls of friction with no safety benefit. The gate now only fires for mutation tools (`Write`, `Edit`, `Bash`, `Task`). The guarantee that matters — rules loaded before mutations — is preserved unchanged.

## [0.23.0] - 2026-04-21

### Added

- **Token-budgeted `load_rules` payload.** Rules are emitted in priority order (corrections → preferences by citation → devops by citation → failures). Dropped rules are surfaced via a `"N more rules available via search_memory"` marker so nothing is silently hidden. Budget configurable via `CLAUDE_RECALL_LOAD_BUDGET_TOKENS` (default 2000).
- **Citation-aware auto-demotion.** Rules loaded many times but never cited can be auto-demoted (flipped to `is_active = 0`) on MCP boot. Env-gated via `CLAUDE_RECALL_AUTO_DEMOTE=true`; thresholds tunable via `CLAUDE_RECALL_DEMOTE_MIN_LOADS` (default 20) and `CLAUDE_RECALL_DEMOTE_MIN_AGE_DAYS` (default 7). Demoted rules remain searchable via `search_memory` and can be restored with `rules promote <id>`.
- **Retroactive fuzzy dedup.** New CLI `rules dedup [--dry-run] [--threshold N]` collapses near-duplicate rules that predate write-time dedup. Keeps the oldest rule per cluster and sums cite/load counts into the winner. Losers are flipped `is_active=0, superseded_by='auto-dedup'` and restorable via `rules promote <id>`.
- **Test-pollution write-time guard + cleanup.** `MemoryService.store()` silently drops writes matching legacy test-fixture patterns (`Test preference 177…`, `Session test preference …`, `Memory with complex metadata`, `Test memory content`). New CLI `cleanup test-pollution [--dry-run]` purges historical pollution.
- **New CLI commands:** `rules demote`, `rules promote <id>`, `rules dedup`, `cleanup test-pollution`.

### Changed

- **`load_rules` no longer emits the Rule Health diagnostic block.** Rules loaded often but never cited still contribute to telemetry and are visible via `npx claude-recall outcomes`; they no longer consume ~10 lines of every `load_rules` response.
- **`load_rules` response shape** now includes `counts.dropped` (integer) indicating how many rules were truncated by the token budget.
- **`loadActiveRules` filters `is_active`** across all categories (preferences, corrections, failures, devops) so auto-demoted rules are excluded uniformly. Previously only preferences were filtered.
- **`promoteRule` widened** to accept both `superseded_by = 'auto-demote'` and `superseded_by = 'auto-dedup'` sentinels. Refuses to restore rules superseded by preference override logic.

### Fixed

- **Integration tests no longer repollute the memory DB.** Integration-test fixture values were the historical source of the `Test preference …` and `Memory with complex metadata` rows in production databases; the new write-time guard surfaced the issue. Fixtures now use unambiguous `integration-fixture …` strings.

### Migration

Existing installs see no behavior change by default (all new auto-demotion is opt-in). To adopt:

```bash
# Preview what auto-demotion would do
npx claude-recall rules demote --dry-run

# Apply
npx claude-recall rules demote

# Retroactively collapse near-duplicates
npx claude-recall rules dedup --dry-run
npx claude-recall rules dedup

# Purge legacy test-pollution rows (if any)
npx claude-recall cleanup test-pollution --dry-run
npx claude-recall cleanup test-pollution
```

To enable auto-demotion on every MCP boot: `export CLAUDE_RECALL_AUTO_DEMOTE=true`.

## [0.7.8] - 2025-11-17

### Added
- **Automatic memory search enforcement** via Claude Code hooks
- Pre-action search enforcer (`pre_tool_search_enforcer.py`) blocks Write/Edit until memory search performed
- User prompt capture hook (`user_prompt_capture.py`) for preference extraction
- Hook scripts auto-installed to `.claude/hooks/` during `npm install`
- Hook configuration auto-added to `.claude/settings.json`
- Session-aware blocking (one search covers multiple subsequent operations)
- New CLI commands:
  - `claude-recall recent-tools --session <id>`: Check if search performed in session
  - `claude-recall capture-prompt --session <id> --content <text>`: Store prompt for processing

### Changed
- Hook enforcement is now standard behavior (can be disabled in `.claude/settings.json`)
- Installation process now includes hook setup (scripts copied and configured automatically)

### Technical Details
- Hooks use Python 3 (pre-installed on most systems)
- Scripts read JSON from stdin (Claude Code hooks protocol)
- Exit code 2 blocks tool execution with educational error message
- Integrated with existing queue/MCP infrastructure

## [0.7.7] - 2025-11-17

### Removed
- **Pattern-analysis memory types** (pattern-analysis, detected-pattern, response-pattern)
- These were system-generated metadata that provided no retrieval utility

### Changed
- Pattern detection logic remains active for PreferenceExtractor
- No code retrieves or uses pattern-analysis memories
- Ranked lowest in relevance scoring

### Migration
Optional cleanup for users upgrading from earlier versions:

```bash
# Remove pattern-analysis memories
npx claude-recall clear --type pattern-analysis --force

# Remove detected-pattern memories
npx claude-recall clear --type detected-pattern --force

# Remove response-pattern memories
npx claude-recall clear --type response-pattern --force
```

**Note:** This cleanup is optional. These memory types are harmless but take up space.

## [0.7.6] - 2025-11-17

### Added
- **Automatic database schema migration**
- Missing columns auto-added on first command after upgrade
- `npx claude-recall migrate schema` command for manual migration
- Console messages during automatic migration:
  ```
  📋 Migrating database schema: Adding scope column...
  ✅ Added scope column
  ```

### Changed
- Added `sophistication_level` column (retroactive from v0.7.0)
- Added `scope` column (retroactive from v0.7.2)
- Database schema now self-healing on upgrades

### Migration

**Automatic Migration:**
The first time you run any command after upgrading to v0.7.6+, missing columns will be added automatically.

**Manual Migration (Optional):**
```bash
# Check current schema and migrate if needed
npx claude-recall migrate schema

# Create backup before migration
npx claude-recall migrate schema --backup
```

**Troubleshooting Schema Errors:**
If you see errors like `"no such column: scope"` or `"no such column: sophistication_level"`:

```bash
npx claude-recall migrate schema --backup
```

This will:
1. Create a backup of your database (if `--backup` flag used)
2. Add any missing columns
3. Create necessary indexes
4. Verify the migration succeeded

## [0.7.5] - 2025-11-17

### Added
- **Project registry** tracking all projects using Claude Recall
- Auto-registration when MCP server starts or during `npm install`
- Registry stored at `~/.claude-recall/projects.json`
- New CLI commands:
  - `claude-recall project list`: Show all registered projects
  - `claude-recall project show`: Show current project details
  - `claude-recall project register`: Manually register project
  - `claude-recall project unregister`: Remove project from registry
  - `claude-recall project clean`: Remove projects not seen in 30+ days

### Changed
- MCP server auto-registers project on startup
- Postinstall script registers project during installation
- Project status tracked (Active/Inactive based on MCP server state)

## [0.7.4] - 2025-11-17

### Added
- **MCP process management** via ProcessManager service
- PID file tracking in `~/.claude-recall/pids/mcp-{projectId}.pid`
- Cross-platform process validation using `process.kill(pid, 0)`
- Project-scoped process tracking (one server per project)
- Auto-cleanup of stale PID files on server start
- New CLI commands:
  - `claude-recall mcp status`: Show current project's server status
  - `claude-recall mcp ps`: List all running servers
  - `claude-recall mcp stop [--project X] [--force]`: Stop server
  - `claude-recall mcp restart [--force]`: Restart server
  - `claude-recall mcp cleanup [--dry-run] [--all]`: Clean up stale processes
- `CLAUDE_RECALL_AUTO_CLEANUP` environment variable for automatic cleanup

### Fixed
- MCP server accumulation (multiple servers running for same project)
- Zombie process cleanup and detection
- "MCP server already running" errors

## [0.7.2] - 2025-11-17

### Added
- **Project-specific memory scoping**
- Three memory scopes:
  - **Universal** (`scope='universal'`): Available in all projects
  - **Project** (`scope='project'`): Only available in current project
  - **Unscoped** (`scope=null`, default): Available everywhere (backward compatible)
- Auto-detection from user language:
  - Universal indicators: "remember everywhere", "for all projects", "globally"
  - Project indicators: "for this project", "project-specific", "only here"
- CLI flags for scope control:
  - `--global`: Search/show memories from all projects
  - `--project <id>`: Search/show memories for specific project

### Changed
- Default search behavior: Current project + universal + unscoped memories
- Stats command shows project-specific statistics by default
- Search command respects project scoping

## [0.7.0] - 2025-11-17

### Added
- **Intelligence & Evolution tracking**
- Automatic failure learning with counterfactual reasoning:
  - What failed
  - Why it failed
  - What should be done instead
  - Preventative checks for future
- Sophistication classification (L1-L4):
  - L1 Procedural: Basic tool use, simple actions
  - L2 Self-Reflection: Error checking, corrections, learning from failures
  - L3 Adaptive: Systematic workflows, devops patterns
  - L4 Compositional: Multi-constraint reasoning, complex decision-making
- New CLI commands:
  - `claude-recall evolution [--days N] [--project X]`: View progression metrics
  - `claude-recall failures [--limit N] [--project X]`: View failures with counterfactual learning
- Progression score tracking (0-100)
- Confidence trends (improving/stable/declining)
- Failure rate trends

### Changed
- All memories automatically classified by sophistication level
- Rich Title/Description/Content format for better readability
- FailureExtractor captures failures automatically from error messages and user corrections

## [0.5.0] - 2025-11-17

### Added
- **Claude Code Skills integration**
- Memory management skill at `.claude/skills/memory-management/SKILL.md`
- DevOps memory type (highest priority):
  - Build/deploy patterns
  - Git workflow conventions
  - Testing preferences
  - Project architecture
  - CI/CD configurations
- Progressive disclosure for workflow instructions
- Skills auto-created during `npm install`

### Changed
- Memory type hierarchy now prioritizes DevOps patterns
- Relevance scoring favors DevOps over tool-use memories

## [0.3.0] - 2025-10-14

### Added

#### Phase 1: MCP Protocol Enhancement
- **MCP Resources support** - Expose memories as subscribable resources
  - `claude-recall://preferences/all` - All user coding preferences
  - `claude-recall://context/active` - Top 5 most relevant memories from last 24 hours
- **MCP Prompts support** - 5 prompt templates with memory context pre-injected
  - `with-preferences` - Auto-inject all coding preferences
  - `with-project-context` - Inject project knowledge (optional topic filter)
  - `with-corrections` - Inject recent corrections to avoid mistakes
  - `with-full-context` - Search and inject relevant memories for specific task
  - `analyze-for-preferences` - Ask Claude Code to analyze conversation and extract preferences
- New handlers: `ResourcesHandler` (src/mcp/resources-handler.ts:454) and `PromptsHandler` (src/mcp/prompts-handler.ts:495)

#### Phase 2: Automatic Intelligence
- **Automatic preference detection** - Detects preference signals in conversations
  - Keyword detection: "prefer", "always", "never", "use", "avoid", etc.
  - Tracks preference signals across conversation turns
- **Automatic analysis triggers** - Suggests analysis after:
  - 5 unanalyzed conversation turns, OR
  - 3 turns with preference signals
- **Conversation tracking** - Enhanced SessionManager tracks last 50 turns per session
- **Batch preference storage** - New `store_preferences` tool for storing multiple preferences at once
- New service: `PreferenceAnalyzer` (src/services/preference-analyzer.ts:315)

#### Phase 3: Proactive Intelligence
- **Context-aware tool descriptions** - Tool descriptions dynamically enhanced with relevant memories
  - Example: `create_file` tool shows "📝 Remember: User prefers TypeScript"
  - Filters memories by relevance threshold (0.7+ confidence)
  - Limits to top 3 memories per tool
- **Proactive memory injection** - Memories automatically injected before tool execution
  - Keyword extraction from tool inputs
  - Top 3 relevant memories added to `_memoryContext` field
  - Works automatically without explicit search
- **Memory usage tracking** - Tracks which memories are actually useful
  - Boosts relevance for effective memories (used >70% of time)
  - Reduces relevance for ignored memories (used <30% of time)
  - Provides effectiveness statistics
- New services:
  - `ContextEnhancer` (src/services/context-enhancer.ts:289)
  - `KeywordExtractor` (src/services/keyword-extractor.ts:218)
  - `MemoryUsageTracker` (src/services/memory-usage-tracker.ts:309)

#### Phase 4: Conversation Context Awareness
- **Duplicate request detection** - Detects when user asks the same question multiple times
  - Configurable detection window (default: 3 turns)
  - Normalizes action keys for consistent matching
  - Returns previous results with helpful suggestions
- **Context-aware suggestions** - Generates helpful responses when duplicates detected
  - Example: "I just performed this exact action in my previous response. Did you want me to re-analyze with different criteria?"
- **Session cleanup** - Automatic cleanup of old sessions (30 minute timeout)
- **Health monitoring** - Conversation context stats added to health check endpoint
- New service: `ConversationContextManager` (src/services/conversation-context-manager.ts:361)
- Comprehensive test coverage: 20 passing unit tests

### Changed

- Enhanced `MCPServer` to support Resources and Prompts protocols (src/mcp/server.ts)
- Modified `SessionManager` to track conversation history with preference signals
- Enhanced `MemoryCaptureMiddleware` with proactive memory injection
- Updated `handleToolsList` to inject memories into tool descriptions
- Updated `handleToolCall` to check for duplicates and inject memories
- Health check endpoint now includes conversation context statistics

### Fixed

- Improved real-time intelligence - system now proactively retrieves memories without explicit search
- Better capture rate for user preferences through multi-pass analysis
- Reduced user corrections needed through proactive context injection

## [0.2.19] - Previous Release

Earlier versions focused on basic MCP server functionality, memory storage, and CLI tools.

---

[0.7.8]: https://github.com/raoulbia-ai/claude-recall/compare/v0.7.7...v0.7.8
[0.7.7]: https://github.com/raoulbia-ai/claude-recall/compare/v0.7.6...v0.7.7
[0.7.6]: https://github.com/raoulbia-ai/claude-recall/compare/v0.7.5...v0.7.6
[0.7.5]: https://github.com/raoulbia-ai/claude-recall/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/raoulbia-ai/claude-recall/compare/v0.7.2...v0.7.4
[0.7.2]: https://github.com/raoulbia-ai/claude-recall/compare/v0.7.0...v0.7.2
[0.7.0]: https://github.com/raoulbia-ai/claude-recall/compare/v0.5.0...v0.7.0
[0.5.0]: https://github.com/raoulbia-ai/claude-recall/compare/v0.3.0...v0.5.0
[0.3.0]: https://github.com/raoulbia-ai/claude-recall/compare/v0.2.19...v0.3.0
