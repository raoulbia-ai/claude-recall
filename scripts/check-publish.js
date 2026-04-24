#!/usr/bin/env node
/**
 * Pre-publish tarball check.
 *
 * Wired via package.json `prepublishOnly`. Inspects what `npm pack` would
 * include and refuses to let `npm publish` complete if any of these is found:
 *
 *   1. A FORBIDDEN PATH — files that should never ship (auto-generated skills,
 *      user settings files, enterprise auth records, build artifacts, audit
 *      reports, env files, node_modules).
 *
 *   2. FORBIDDEN CONTENT inside any shipped text file — internal product
 *      names from the maintainer's other projects, the maintainer's home-dir
 *      paths, or credential prefixes that look like leaked secrets.
 *
 * Background: this exists because earlier published versions of claude-recall
 * (0.20.13 to 0.23.3) shipped artifacts that the SkillGenerator wrote into
 * the auto-skills subdirectory from the maintainer's personal memory database.
 * See .gstack/security-reports/2026-04-24-fixes-applied.md for the full audit.
 *
 * The script intentionally errs on the side of false positives. A legitimate
 * mention of one of the forbidden terms can be allowlisted by editing the
 * lists below; silently shipping a leak cannot be undone.
 *
 * Bypass: `npm publish --ignore-scripts` (only if you know why).
 */

const { execSync } = require('child_process');
const fs = require('fs');

// ── Configuration ───────────────────────────────────────────────────────────

const FORBIDDEN_PATHS = [
  // Runtime exhaust from claude-recall itself
  /^\.claude\/skills\/auto-/,
  /^\.claude\/settings.*\.json$/,
  /^\.claude-recall\//,

  // Audit artifacts (for the repo, not users)
  /^\.gstack\//,

  // Personal/auth files that enterprise tools sometimes drop into cwd
  /_authrecord$/,
  /^\.azure\//,

  // Should never ship
  /^node_modules\//,
  /^\.env(\.|$)/,
  /\.tgz$/,
  /^claude-recall-\d/,

  // Editor / cache leftovers
  /^\.jest-cache\//,
  /^\.vscode\//,
  /^\.idea\//,
  /\.DS_Store$/,
];

const FORBIDDEN_CONTENT = [
  // Internal product / component names from the maintainer's other work.
  // Add new entries when new internal names enter the maintainer's vocabulary.
  /\bnemoclaw\b/i,
  /\bopenshell\b/i,
  /\bopenclaw\b/i,
  /\bericai\b/i,
  /\bmock-eiap\b/i,
  /\bnka-telco\b/i,
  /\bsentinel\b.*sandbox/i, // 'sentinel' alone is too generic; pair with sandbox

  // Maintainer identity (paths and email)
  /\bebiarao\b/i,
  /raoul\.biagioni@/i,
  /\/home\/ebiarao\//,
  /\/Users\/ebiarao\//,

  // Credential prefixes — defensive, should never appear in source
  /sk-ant-api03-[A-Za-z0-9_-]{20,}/,
  /sk_live_[A-Za-z0-9]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /ghp_[A-Za-z0-9]{36,}/,
  /xox[bpas]-[A-Za-z0-9-]{20,}/,
  /eyJhbGciOi[A-Za-z0-9_-]{20,}/, // JWT-looking tokens
];

// Files where content scanning would be noisy or pointless.
const SKIP_CONTENT_CHECK = [
  /\.(png|jpe?g|gif|ico|svg|webp)$/i,
  /\.(woff2?|ttf|otf|eot)$/i,
  /\.(zip|gz|bz2|tar|7z)$/i,
  /\.(so|dylib|dll|node|wasm)$/i,
  /\.(mp[34]|wav|webm|mov)$/i,
  /\.(pdf)$/i,
];

// ── Helpers ─────────────────────────────────────────────────────────────────

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function getPackedFiles() {
  const out = execSync('npm pack --dry-run --json', { encoding: 'utf8' });
  const arr = JSON.parse(out);
  if (!Array.isArray(arr) || !arr[0] || !Array.isArray(arr[0].files)) {
    throw new Error('Unexpected `npm pack --dry-run --json` output shape');
  }
  return arr[0].files.map(f => f.path);
}

function checkPaths(files) {
  const hits = [];
  for (const file of files) {
    for (const pattern of FORBIDDEN_PATHS) {
      if (pattern.test(file)) {
        hits.push({ file, pattern: pattern.toString() });
        break;
      }
    }
  }
  return hits;
}

function checkContent(files) {
  const hits = [];
  for (const file of files) {
    if (SKIP_CONTENT_CHECK.some(s => s.test(file))) continue;
    if (!fs.existsSync(file)) continue;

    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue; // binary or unreadable, skip
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of FORBIDDEN_CONTENT) {
        if (pattern.test(line)) {
          const snippet = line.trim();
          hits.push({
            file,
            lineNumber: i + 1,
            pattern: pattern.toString(),
            snippet: snippet.length > 120 ? snippet.substring(0, 120) + '…' : snippet,
          });
          break; // one hit per line is plenty
        }
      }
    }
  }
  return hits;
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  console.log(`${BOLD}🔍 Pre-publish tarball check${RESET}`);
  console.log(`${DIM}   (scripts/check-publish.js — bypass with \`npm publish --ignore-scripts\`)${RESET}\n`);

  let files;
  try {
    files = getPackedFiles();
  } catch (err) {
    console.error(`${RED}Failed to enumerate packed files: ${err.message}${RESET}`);
    process.exit(2);
  }

  console.log(`Files in tarball: ${files.length}\n`);

  const pathHits = checkPaths(files);
  const contentHits = checkContent(files);

  if (pathHits.length === 0 && contentHits.length === 0) {
    console.log(`${GREEN}${BOLD}✓ No violations. Publish allowed.${RESET}\n`);
    process.exit(0);
  }

  if (pathHits.length > 0) {
    console.log(`${RED}${BOLD}✖ Forbidden files in tarball (${pathHits.length}):${RESET}\n`);
    for (const h of pathHits) {
      console.log(`  ${RED}${h.file}${RESET}`);
      console.log(`     ${DIM}matched ${h.pattern}${RESET}`);
    }
    console.log('');
  }

  if (contentHits.length > 0) {
    console.log(`${RED}${BOLD}✖ Forbidden content in shipped files (${contentHits.length}):${RESET}\n`);
    for (const h of contentHits) {
      console.log(`  ${RED}${h.file}:${h.lineNumber}${RESET}`);
      console.log(`     ${DIM}matched ${h.pattern}${RESET}`);
      console.log(`     ${YELLOW}${h.snippet}${RESET}`);
    }
    console.log('');
  }

  const total = pathHits.length + contentHits.length;
  console.log(`${BOLD}📊 ${total} violation(s) found${RESET}`);
  console.log(`${RED}${BOLD}🚫 Publish blocked.${RESET}\n`);
  console.log(`Fix the items above. Common remediations:`);
  console.log(`  • forbidden file in tarball → narrow ${BOLD}package.json${RESET} \`files\` array, or add to ${BOLD}.gitignore${RESET}`);
  console.log(`  • forbidden content match  → edit/remove the offending line, or allowlist the pattern in ${BOLD}scripts/check-publish.js${RESET} if it is a genuine false positive`);
  console.log('');
  console.log(`Re-run with: ${BOLD}npm publish${RESET}`);
  console.log(`Emergency bypass (will leak if violations are real): ${BOLD}npm publish --ignore-scripts${RESET}`);
  console.log('');

  process.exit(1);
}

main();
