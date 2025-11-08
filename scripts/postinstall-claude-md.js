#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('\n📋 Setting up .claude/ directory structure...\n');

/**
 * Find the project root by traversing up from node_modules/claude-recall/scripts/
 * This is more reliable than process.cwd() during npm install
 */
function findProjectRoot() {
  // During npm install, this script is at: <project>/node_modules/claude-recall/scripts/postinstall-claude-md.js
  // We need to go up 3 levels to reach <project>/
  let currentDir = __dirname;

  // Go up from scripts/ -> claude-recall/ -> node_modules/ -> <project>/
  const projectRoot = path.join(currentDir, '..', '..', '..');

  console.log(`   🔍 Detected project root: ${projectRoot}`);

  // Verify this is actually a project root
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    console.log('   ⚠️  No package.json found at project root, skipping .claude/ setup');
    return null;
  }

  return projectRoot;
}

try {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    process.exit(0);
  }

  // Paths
  const claudeDir = path.join(projectRoot, '.claude');
  const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
  const agentsDir = path.join(claudeDir, 'agents');
  const skillsDir = path.join(claudeDir, 'skills');
  const memoryManagementDir = path.join(skillsDir, 'memory-management');
  const referencesDir = path.join(memoryManagementDir, 'references');

  // Source paths (in node_modules/claude-recall/.claude/)
  const sourceClaudeDir = path.join(__dirname, '..', '.claude');
  const sourceClaudeMd = path.join(sourceClaudeDir, 'CLAUDE.md');
  const sourceAgentsDir = path.join(sourceClaudeDir, 'agents');
  const sourceSkillsDir = path.join(sourceClaudeDir, 'skills');

  console.log(`   📂 Source directory: ${sourceClaudeDir}`);

  // Create directories
  [claudeDir, agentsDir, skillsDir, memoryManagementDir, referencesDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`   📁 Created ${path.relative(projectRoot, dir)}/`);
    }
  });

  // Handle CLAUDE.md - merge if exists, create if not
  if (fs.existsSync(sourceClaudeMd)) {
    if (fs.existsSync(claudeMdPath)) {
      // CLAUDE.md already exists - prepend Skills reference
      console.log('   ℹ️  Existing CLAUDE.md found, preserving content');
      const existingContent = fs.readFileSync(claudeMdPath, 'utf-8');
      const sourceContent = fs.readFileSync(sourceClaudeMd, 'utf-8');

      // Check if Skills reference already exists
      if (!existingContent.includes('Claude Code Skills Integration') &&
          !existingContent.includes('.claude/skills/memory-management')) {
        const prependText = `# Claude Recall - Skills Integration\n\n` +
          `**Note**: Claude Recall now uses Claude Code Skills for better memory management.\n` +
          `See [.claude/skills/memory-management/SKILL.md](./.claude/skills/memory-management/SKILL.md) for details.\n\n` +
          `---\n\n`;

        fs.writeFileSync(claudeMdPath, prependText + existingContent);
        console.log('   ✅ Added Skills reference to existing CLAUDE.md');
      } else {
        console.log('   ⏭️  CLAUDE.md already has Skills reference, skipping');
      }
    } else {
      // No CLAUDE.md exists - create new one
      fs.copyFileSync(sourceClaudeMd, claudeMdPath);
      console.log('   ✅ Created .claude/CLAUDE.md');
    }
  }

  // Copy agents directory if exists
  if (fs.existsSync(sourceAgentsDir)) {
    const agentFiles = fs.readdirSync(sourceAgentsDir).filter(f => f.endsWith('.md'));
    let copiedCount = 0;
    agentFiles.forEach(file => {
      const sourcePath = path.join(sourceAgentsDir, file);
      const destPath = path.join(agentsDir, file);
      if (!fs.existsSync(destPath) && fs.statSync(sourcePath).isFile()) {
        fs.copyFileSync(sourcePath, destPath);
        copiedCount++;
      }
    });
    if (copiedCount > 0) {
      console.log(`   ✅ Created .claude/agents/ (${copiedCount} file${copiedCount > 1 ? 's' : ''})`);
    }
  }

  // Copy skills directory if exists
  if (fs.existsSync(sourceSkillsDir)) {
    // Copy SKILL.md
    const skillMdSource = path.join(sourceSkillsDir, 'memory-management', 'SKILL.md');
    const skillMdDest = path.join(memoryManagementDir, 'SKILL.md');
    if (fs.existsSync(skillMdSource)) {
      if (!fs.existsSync(skillMdDest)) {
        fs.copyFileSync(skillMdSource, skillMdDest);
        console.log('   ✅ Created .claude/skills/memory-management/SKILL.md');
      } else {
        console.log('   ⏭️  SKILL.md already exists, skipping');
      }
    } else {
      console.log('   ⚠️  Warning: SKILL.md not found in source');
    }

    // Copy reference files
    const sourceReferencesDir = path.join(sourceSkillsDir, 'memory-management', 'references');
    if (fs.existsSync(sourceReferencesDir)) {
      const refFiles = fs.readdirSync(sourceReferencesDir).filter(f => f.endsWith('.md'));
      let copiedCount = 0;
      refFiles.forEach(file => {
        const sourcePath = path.join(sourceReferencesDir, file);
        const destPath = path.join(referencesDir, file);
        if (!fs.existsSync(destPath) && fs.statSync(sourcePath).isFile()) {
          fs.copyFileSync(sourcePath, destPath);
          copiedCount++;
        }
      });
      if (copiedCount > 0) {
        console.log(`   ✅ Created .claude/skills/memory-management/references/ (${copiedCount} file${copiedCount > 1 ? 's' : ''})`);
      }
    } else {
      console.log('   ⚠️  Warning: references/ directory not found in source');
    }
  }

  console.log('\n✅ .claude/ directory structure created successfully');
  console.log('\n💡 Claude Code Skills Integration:');
  console.log('   - SKILL.md teaches Claude how to use memory system');
  console.log('   - Skills are loaded automatically by Claude Code runtime');
  console.log('   - See .claude/skills/memory-management/SKILL.md for details\n');

} catch (error) {
  console.error('❌ Error setting up .claude/ directory:', error.message);
  // Don't fail installation
  process.exit(0);
}
