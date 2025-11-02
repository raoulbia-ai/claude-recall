#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('\n📋 Setting up .claude/ directory structure...\n');

try {
  // Determine project root (where package.json is)
  const projectRoot = process.cwd();

  // Check if we're in a project (has package.json)
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    console.log('   Not in a project directory, skipping .claude/ setup');
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
  const sourceClaude Md = path.join(sourceClaudeDir, 'CLAUDE.md');
  const sourceAgentsDir = path.join(sourceClaudeDir, 'agents');
  const sourceSkillsDir = path.join(sourceClaudeDir, 'skills');

  // Create directories
  [claudeDir, agentsDir, skillsDir, memoryManagementDir, referencesDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // Copy CLAUDE.md if source exists and target doesn't
  if (fs.existsSync(sourceClaude Md) && !fs.existsSync(claudeMdPath)) {
    fs.copyFileSync(sourceClaude Md, claudeMdPath);
    console.log('   ✅ Created .claude/CLAUDE.md');
  }

  // Copy agents directory if exists
  if (fs.existsSync(sourceAgentsDir)) {
    const agentFiles = fs.readdirSync(sourceAgentsDir);
    agentFiles.forEach(file => {
      const sourcePath = path.join(sourceAgentsDir, file);
      const destPath = path.join(agentsDir, file);
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(sourcePath, destPath);
      }
    });
    console.log('   ✅ Created .claude/agents/');
  }

  // Copy skills directory if exists
  if (fs.existsSync(sourceSkillsDir)) {
    // Copy SKILL.md
    const skillMdSource = path.join(sourceSkillsDir, 'memory-management', 'SKILL.md');
    const skillMdDest = path.join(memoryManagementDir, 'SKILL.md');
    if (fs.existsSync(skillMdSource) && !fs.existsSync(skillMdDest)) {
      fs.copyFileSync(skillMdSource, skillMdDest);
      console.log('   ✅ Created .claude/skills/memory-management/SKILL.md');
    }

    // Copy reference files
    const sourceReferencesDir = path.join(sourceSkillsDir, 'memory-management', 'references');
    if (fs.existsSync(sourceReferencesDir)) {
      const refFiles = fs.readdirSync(sourceReferencesDir);
      refFiles.forEach(file => {
        const sourcePath = path.join(sourceReferencesDir, file);
        const destPath = path.join(referencesDir, file);
        if (!fs.existsSync(destPath)) {
          fs.copyFileSync(sourcePath, destPath);
        }
      });
      console.log('   ✅ Created .claude/skills/memory-management/references/');
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
