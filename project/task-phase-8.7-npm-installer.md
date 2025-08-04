# Phase 8.7: NPM Installer & Dependency Automation Task

## Mission Statement
Create a seamless installation experience for claude-recall that integrates with NPM workflow and automatically handles all Claude Code integration, dependencies, and setup requirements.

## Current Installation Problems

### Manual Setup Required
- Users must manually copy files to `~/.claude/` directory
- Hook files need manual executable permissions
- Claude Code settings.json requires manual editing
- Directory structure must be created manually
- No validation that setup worked correctly

### Developer-Only Accessibility
- Current method: `git clone` + manual setup
- No NPM package available for end users
- No automated dependency resolution
- Complex setup process deters adoption

### Missing Integration
- No `postinstall` scripts for automation
- No CLI commands for setup/validation
- No cross-platform compatibility testing
- No uninstall mechanism

## Task Objectives

### Primary Goal
Transform claude-recall into a professional NPM package with automated installation that works seamlessly with Claude Code.

### Specific Implementation Tasks

#### 1. NPM Package Preparation
**Create production-ready package structure:**
- Update `package.json` for NPM publication
- Add proper `main`, `bin`, `scripts` entries
- Define `engines` requirements (Node.js version)
- Add comprehensive `keywords`, `description` for discoverability
- Create `.npmignore` for clean package distribution

#### 2. Automated Installer Script
**Create `scripts/install.js` that handles:**
- **Claude Code detection**: Verify Claude Code is installed and running
- **Directory setup**: Create `~/.claude/` structure if missing
- **Hook installation**: Copy and set executable permissions on hook files
- **Settings integration**: Update Claude Code's `settings.json` with hook configuration
- **Database initialization**: Create initial SQLite database
- **Validation**: Test that hooks work with Claude Code

#### 3. Cross-Platform Compatibility
**Ensure installer works on:**
- **macOS**: Handle different Shell environments and permissions
- **Windows**: Support Windows paths and file permissions
- **Linux**: Various distributions and permission models
- **Path detection**: Find Claude Code installation across platforms

#### 4. NPM Lifecycle Integration
**Integrate with NPM install workflow:**
- **`postinstall` script**: Automatically run installer after `npm install -g claude-recall`
- **`preuninstall` script**: Clean up hooks and settings before removal
- **Error handling**: Graceful failure with helpful error messages
- **Skip options**: Allow advanced users to skip auto-setup

#### 5. CLI Enhancement
**Extend existing CLI with installation commands:**
- `claude-recall install` - Manual installation trigger
- `claude-recall validate` - Test that installation worked
- `claude-recall uninstall` - Clean removal of hooks and settings
- `claude-recall status` - Show installation and operation status

#### 6. User Experience
**Create seamless user journey:**
- **One command install**: `npm install -g claude-recall`
- **Automatic setup**: No manual steps required
- **Clear feedback**: Progress indicators and success/error messages
- **Documentation**: Update README with simple installation instructions

## Implementation Strategy

### Phase A: Package Preparation
1. **Update package.json for NPM distribution**
   - Add proper metadata and scripts
   - Define CLI commands and entry points
   - Set engine requirements and dependencies

2. **Create installer infrastructure**
   - Build cross-platform path detection utilities
   - Create Claude Code integration helpers
   - Design error handling and logging system

### Phase B: Installer Script Development
1. **Core installer functionality**
   - Claude Code detection and validation
   - Directory structure creation
   - Hook file installation with permissions
   - Settings.json integration

2. **Cross-platform testing**
   - Test on macOS, Windows, Linux
   - Handle edge cases and permission issues
   - Validate on different Claude Code versions

### Phase C: NPM Integration
1. **Lifecycle scripts**
   - Implement postinstall automation
   - Create preuninstall cleanup
   - Add validation and status commands

2. **Error handling and recovery**
   - Graceful failure modes
   - Helpful error messages with solutions
   - Recovery mechanisms for partial installations

## Technical Requirements

### File Structure
```
claude-recall/
├── package.json (updated for NPM)
├── scripts/
│   ├── install.js (main installer)
│   ├── platform-utils.js (cross-platform helpers)
│   └── claude-integration.js (Claude Code specific)
├── templates/
│   ├── settings-template.json (Claude Code settings)
│   └── hook-templates/ (hook file templates)
└── README.md (updated installation docs)
```

### Package.json Updates Required
```json
{
  "name": "claude-recall",
  "version": "1.0.0",
  "description": "Memory system for Claude Code with behavioral learning",
  "main": "dist/cli/claude-recall-cli.js",
  "bin": {
    "claude-recall": "dist/cli/claude-recall-cli.js"
  },
  "scripts": {
    "postinstall": "node scripts/install.js",
    "preuninstall": "node scripts/uninstall.js"
  },
  "engines": {
    "node": ">=16.0.0"
  },
  "keywords": ["claude-code", "memory", "ai", "productivity"]
}
```

### Cross-Platform Considerations
- **Path handling**: Use `path.join()` and OS-specific separators
- **Permissions**: Handle Unix vs Windows file permissions differently  
- **Environment detection**: Detect Shell environment and Claude Code installation
- **User directories**: Handle different home directory structures

### Claude Code Integration Points
1. **Settings location detection**: Find `~/.claude/settings.json`
2. **Hook directory setup**: Create and populate `~/.claude/hooks/`
3. **Settings merge**: Add hook configuration without breaking existing settings
4. **Validation**: Test hooks actually work with Claude Code

## Success Metrics

### Installation Success
- ✅ One-command install: `npm install -g claude-recall`
- ✅ Automatic setup without manual intervention
- ✅ Works on macOS, Windows, Linux
- ✅ Validates successful installation
- ✅ Clear error messages for any failures

### User Experience
- ✅ Installation completes in <30 seconds
- ✅ Clear progress feedback during install
- ✅ Helpful documentation and error messages
- ✅ Easy uninstall process
- ✅ Status command shows system health

### Technical Integration
- ✅ All dependencies resolved automatically
- ✅ Hook files have correct permissions
- ✅ Claude Code settings properly updated
- ✅ SQLite database initialized correctly
- ✅ CLI commands work globally after install

## Test Plan

### Installation Testing
1. **Fresh system testing**: Install on clean systems
2. **Upgrade testing**: Test upgrading from previous versions
3. **Conflict resolution**: Test with existing Claude Code configurations
4. **Error scenarios**: Test various failure modes and recovery

### Cross-Platform Validation
1. **macOS testing**: Multiple versions and Shell environments
2. **Windows testing**: PowerShell, Command Prompt, WSL
3. **Linux testing**: Ubuntu, CentOS, different permission models
4. **Edge cases**: Unusual installation paths, permission restrictions

### Integration Testing
1. **Claude Code compatibility**: Test with different Claude Code versions
2. **Hook functionality**: Verify hooks work after automated installation
3. **Memory system**: Test full end-to-end functionality post-install
4. **CLI validation**: All CLI commands work correctly

## Risk Management

### Identified Risks
1. **Permission failures**: Mitigated by graceful fallback and clear error messages
2. **Claude Code detection failures**: Mitigated by multiple detection strategies
3. **Settings corruption**: Mitigated by backup and restore mechanisms
4. **Cross-platform incompatibilities**: Mitigated by extensive testing

### Rollback Plan
- Backup existing Claude Code settings before modification
- Provide manual installation instructions as fallback
- Include repair/reinstall commands for failed installations
- Clear uninstall process to remove all traces

## Expected Outcome

After Phase 8.7 completion, users will experience:

```bash
# Simple installation
npm install -g claude-recall

# Automatic setup with progress feedback
✓ Detecting Claude Code installation...
✓ Creating directory structure...
✓ Installing hook files...
✓ Updating Claude Code settings...
✓ Initializing memory database...
✓ Validating installation...

Claude Recall installed successfully!
```

### Post-Installation Experience
- Hooks automatically active in Claude Code
- Memory system working immediately
- All CLI commands available globally
- Clear status and validation tools
- Easy uninstall if needed

This will transform claude-recall from a developer tool to a production-ready package that any Claude Code user can install and use immediately.

## Swarm Instructions

### Agent Roles Needed
1. **Package-Engineer**: NPM package preparation and publishing setup
2. **Installer-Developer**: Cross-platform installer script development
3. **Integration-Specialist**: Claude Code integration and settings management
4. **Test-Engineer**: Cross-platform testing and validation
5. **UX-Designer**: User experience and documentation

### Coordination Protocol
All agents must coordinate through existing swarm memory system and provide regular progress updates with testing results from multiple platforms.

### Priority Order
1. Package preparation and structure (highest priority)
2. Core installer script development
3. Cross-platform compatibility testing
4. NPM lifecycle integration
5. Documentation and user experience polish

The goal is to create a professional, user-friendly installation experience that makes claude-recall accessible to all Claude Code users, not just developers.