# Task: Phase 8.8 - SQLite Database Management

## Context
Claude-recall stores memories in SQLite databases that are project-specific. Each project gets its own `claude-recall.db` file. While this naturally bounds database size to project lifecycles, we need automatic management to ensure optimal performance over months of project work.

## Current State
- Database grows indefinitely (currently ~1.1MB with 919 memories)
- No automatic cleanup or deduplication
- No VACUUM operations to reclaim space
- Manual intervention required if database gets too large

## Requirements
Implement lightweight, automatic SQLite management that:
1. Runs invisibly without user intervention
2. Maintains database performance and reasonable size
3. Preserves valuable memories (preferences, patterns)
4. Provides manual compact command for power users

## Implementation Plan

### 1. Automatic Compaction Triggers
- On startup if database > 10MB or > 10,000 memories
- Weekly check during normal operation
- After bulk operations (imports, migrations)

### 2. Compaction Strategy
```javascript
// Lightweight approach (~100 lines total)
async compact() {
  // 1. Deduplicate identical memories (same type, key, value)
  // 2. Prune old tool-use memories (keep last 1000)
  // 3. Prune old corrections (keep last 100 per pattern)
  // 4. Keep ALL preferences and project knowledge (high value)
  // 5. Run VACUUM to reclaim space
}
```

### 3. CLI Command
```bash
npx claude-recall compact        # Manual compaction
npx claude-recall compact --dry-run  # Preview what would be removed
```

### 4. Configuration
Add to config:
```json
{
  "database": {
    "autoCompact": true,
    "compactThreshold": 10485760,  // 10MB
    "maxMemories": 10000,
    "retention": {
      "toolUse": 1000,
      "corrections": 100,
      "preferences": -1,  // Keep forever
      "projectKnowledge": -1  // Keep forever
    }
  }
}
```

### 5. User Experience
- Silent operation - no prompts or interruptions
- Log compaction results to info.log
- Show brief message only if significant space reclaimed
- Preserve database backup before compaction

## Technical Implementation

### Files to Create/Modify:
1. `src/services/database-manager.ts` - New service for DB management
2. `src/cli/claude-recall-cli.ts` - Add compact command
3. `src/services/config.ts` - Add database config section
4. `src/services/hook.ts` - Call compact on startup if needed

### Database Operations:
```sql
-- Deduplicate
DELETE FROM memories 
WHERE rowid NOT IN (
  SELECT MIN(rowid) 
  FROM memories 
  GROUP BY type, key, value
);

-- Prune old tool-use
DELETE FROM memories 
WHERE type = 'tool-use' 
AND timestamp < (
  SELECT timestamp FROM memories 
  WHERE type = 'tool-use' 
  ORDER BY timestamp DESC 
  LIMIT 1 OFFSET 1000
);

-- VACUUM
VACUUM;
```

## Success Criteria
1. ✅ Automatic compaction runs on startup when thresholds exceeded
2. ✅ Manual compact command works with --dry-run option
3. ✅ Database size reduced after compaction
4. ✅ Performance maintained (compact operation < 1 second)
5. ✅ No data loss of valuable memories (preferences, patterns)
6. ✅ User configuration respected

## Testing
1. Create large test database (>10MB, >10k memories)
2. Run automatic compaction on startup
3. Verify deduplication works correctly
4. Test manual compact command
5. Measure performance impact
6. Verify backup creation

## Notes
- Keep implementation lightweight (<200 lines total)
- Focus on invisible, automatic operation
- Preserve all high-value memories
- Make it "just work" without user configuration