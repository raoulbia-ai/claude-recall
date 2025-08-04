#!/usr/bin/env node
/**
 * Claude Code Integration Utilities
 * Handles Claude Code settings management and hook installation
 */

const path = require('path');
const fs = require('fs');
const PlatformUtils = require('./platform-utils');

class ClaudeIntegration {
    constructor() {
        this.platform = new PlatformUtils();
        this.claudeDir = this.platform.getClaudeDir();
        this.hooksDir = this.platform.getClaudeHooksDir();
        this.settingsPath = this.platform.getClaudeSettingsPath();
    }

    /**
     * Initialize Claude Code integration
     */
    async initialize() {
        console.log('🚀 Initializing Claude Code integration...');
        
        // Detect Claude Code installation
        const claudeDetection = await this.platform.detectClaudeCode();
        if (!claudeDetection.found) {
            console.warn('⚠️  Claude Code not detected. Installation will continue but manual setup may be required.');
        } else {
            console.log('✓ Claude Code detected');
        }

        // Create directory structure
        const success = await this.createDirectoryStructure();
        if (!success) {
            throw new Error('Failed to create Claude directory structure');
        }

        return true;
    }

    /**
     * Create Claude Code directory structure
     */
    async createDirectoryStructure() {
        console.log('📁 Creating Claude Code directory structure...');
        
        const directories = [
            this.claudeDir,
            this.hooksDir
        ];

        for (const dir of directories) {
            const success = await this.platform.ensureDirectory(dir);
            if (!success) {
                return false;
            }
        }

        return true;
    }

    /**
     * Install hook files from the built distribution
     */
    async installHooks() {
        console.log('🔗 Installing Claude Recall hooks...');
        
        const projectRoot = path.resolve(__dirname, '..');
        // Check if we're already in dist directory
        const isInDist = __dirname.includes('dist');
        const hooksSourceDir = isInDist 
            ? path.join(projectRoot, 'hooks', 'minimal')
            : path.join(projectRoot, 'dist', 'hooks', 'minimal');
        
        if (!fs.existsSync(hooksSourceDir)) {
            throw new Error(`Hook source directory not found: ${hooksSourceDir}. Please run 'npm run build' first.`);
        }

        const hookFiles = [
            'post-tool-trigger.js',
            'pre-tool-trigger.js', 
            'user-prompt-submit-trigger.js'
        ];

        let installedCount = 0;
        for (const hookFile of hookFiles) {
            const sourcePath = path.join(hooksSourceDir, hookFile);
            const destPath = path.join(this.hooksDir, hookFile);
            
            if (fs.existsSync(sourcePath)) {
                const success = await this.platform.copyFile(sourcePath, destPath, true);
                if (success) {
                    installedCount++;
                }
            } else {
                console.warn(`⚠️  Hook file not found: ${sourcePath}`);
            }
        }

        if (installedCount === 0) {
            throw new Error('No hook files were installed successfully');
        }

        console.log(`✓ Installed ${installedCount} hook files`);
        return true;
    }

    /**
     * Update Claude Code settings.json with hook configuration
     */
    async updateSettings() {
        console.log('⚙️  Updating Claude Code settings...');
        
        // Read existing settings or create default
        let settings = await this.platform.readJsonFile(this.settingsPath) || {};
        
        // Ensure hooks configuration exists
        if (!settings.hooks) {
            settings.hooks = {};
        }

        // Add Claude Recall hooks
        // Use direct commands instead of file paths for better compatibility
        const hookConfig = {
            "pre-tool": "npx claude-recall capture pre-tool",
            "post-tool": "npx claude-recall capture post-tool",
            "user-prompt-submit": "npx claude-recall capture user-prompt"
        };

        // Update settings with hook configuration
        settings.hooks = { ...settings.hooks, ...hookConfig };
        
        // Also add capitalized versions for compatibility with different Claude versions
        const capitalizedHookConfig = {
            "UserPromptSubmit": "npx claude-recall capture user-prompt",
            "PreToolUse": "npx claude-recall capture pre-tool",
            "PostToolUse": "npx claude-recall capture post-tool"
        };
        
        // Merge both formats
        settings.hooks = { ...settings.hooks, ...capitalizedHookConfig };

        // Add Claude Recall specific settings
        if (!settings["claude-recall"]) {
            settings["claude-recall"] = {
                "enabled": true,
                "memory-injection": true,
                "behavioral-learning": true,
                "auto-capture": true
            };
        }

        // Write updated settings
        const success = await this.platform.writeJsonFile(this.settingsPath, settings, true);
        if (!success) {
            throw new Error('Failed to update Claude Code settings');
        }

        console.log('✓ Claude Code settings updated');
        return true;
    }

    /**
     * Initialize SQLite database
     */
    async initializeDatabase() {
        console.log('🗄️  Initializing memory database...');
        
        const projectRoot = path.resolve(__dirname, '..');
        const dbPath = path.join(projectRoot, 'claude-recall.db');
        
        // Check if database already exists
        if (fs.existsSync(dbPath)) {
            console.log('✓ Database already exists');
            return true;
        }

        try {
            // Use the CLI to initialize the database
            const { runCommand } = this.platform;
            // Check if we're already in dist directory
            const isInDist = __dirname.includes('dist');
            const cliPath = isInDist
                ? path.join(projectRoot, 'cli', 'claude-recall-cli.js')
                : path.join(projectRoot, 'dist', 'cli', 'claude-recall-cli.js');
            
            if (fs.existsSync(cliPath)) {
                await runCommand(`node "${cliPath}" stats`, { stdio: 'ignore' });
                console.log('✓ Database initialized');
            } else {
                console.warn('⚠️  CLI not found, database will be created on first use');
            }
            
            return true;
        } catch (error) {
            console.warn('⚠️  Database initialization skipped:', error.message);
            return true; // Non-critical error
        }
    }

    /**
     * Validate the installation
     */
    async validateInstallation() {
        console.log('🔍 Validating installation...');
        
        const checks = [
            { name: 'Claude directory', path: this.claudeDir },
            { name: 'Hooks directory', path: this.hooksDir },
            { name: 'Settings file', path: this.settingsPath }
        ];

        let allPassed = true;
        for (const check of checks) {
            if (this.platform.fileExists(check.path)) {
                console.log(`✓ ${check.name}: ${check.path}`);
            } else {
                console.error(`✗ ${check.name} missing: ${check.path}`);
                allPassed = false;
            }
        }

        // Check hook files
        const hookFiles = ['post-tool-trigger.js', 'pre-tool-trigger.js', 'user-prompt-submit-trigger.js'];
        for (const hookFile of hookFiles) {
            const hookPath = path.join(this.hooksDir, hookFile);
            if (this.platform.fileExists(hookPath)) {
                console.log(`✓ Hook installed: ${hookFile}`);
            } else {
                console.error(`✗ Hook missing: ${hookFile}`);
                allPassed = false;
            }
        }

        // Check settings for Claude Recall configuration
        let settingsValid = false;
        try {
            const settings = await this.platform.readJsonFile(this.settingsPath);
            if (settings && settings.hooks && settings['claude-recall']) {
                settingsValid = true;
            }
        } catch (error) {
            // Settings file might not be readable
        }
        
        return {
            hooksValid: allPassed,
            settingsValid: settingsValid,
            allValid: allPassed && settingsValid
        };
    }

    /**
     * Clean up installation (for uninstall)
     */
    async cleanup() {
        console.log('🧹 Cleaning up Claude Recall installation...');
        
        try {
            // Remove hook files
            const hookFiles = ['post-tool-trigger.js', 'pre-tool-trigger.js', 'user-prompt-submit-trigger.js'];
            for (const hookFile of hookFiles) {
                const hookPath = path.join(this.hooksDir, hookFile);
                if (fs.existsSync(hookPath)) {
                    fs.unlinkSync(hookPath);
                    console.log(`✓ Removed hook: ${hookFile}`);
                }
            }

            // Remove Claude Recall settings from settings.json
            const settings = await this.platform.readJsonFile(this.settingsPath);
            if (settings && settings.hooks) {
                // Remove our hook entries
                delete settings.hooks["pre-tool"];
                delete settings.hooks["post-tool"];
                delete settings.hooks["user-prompt-submit"];
                
                // Remove Claude Recall settings
                delete settings["claude-recall"];
                
                await this.platform.writeJsonFile(this.settingsPath, settings, true);
                console.log('✓ Removed Claude Recall settings');
            }

            console.log('✓ Cleanup completed');
            return true;
        } catch (error) {
            console.error('✗ Cleanup failed:', error.message);
            return false;
        }
    }

    /**
     * Get installation status
     */
    async getStatus() {
        const status = {
            claudeDir: {
                path: this.claudeDir,
                exists: this.platform.fileExists(this.claudeDir)
            },
            hooksDir: {
                path: this.hooksDir,
                exists: this.platform.fileExists(this.hooksDir)
            },
            settingsFile: {
                path: this.settingsPath,
                exists: this.platform.fileExists(this.settingsPath)
            },
            hooks: {},
            claudeDetection: await this.platform.detectClaudeCode()
        };

        // Check each hook file
        const hookFiles = ['post-tool-trigger.js', 'pre-tool-trigger.js', 'user-prompt-submit-trigger.js'];
        for (const hookFile of hookFiles) {
            const hookPath = path.join(this.hooksDir, hookFile);
            status.hooks[hookFile] = {
                path: hookPath,
                exists: this.platform.fileExists(hookPath)
            };
        }

        return status;
    }
}

module.exports = ClaudeIntegration;