#!/usr/bin/env node
/**
 * Claude Recall NPM Installer
 * Automated installation script for Claude Code integration
 */

const PlatformUtils = require('./platform-utils');
const ClaudeIntegration = require('./claude-integration');

class ClaudeRecallInstaller {
    constructor() {
        this.platform = new PlatformUtils();
        this.claude = new ClaudeIntegration();
        this.skipInstall = process.env.CLAUDE_RECALL_SKIP_INSTALL === 'true';
        this.verbose = process.env.CLAUDE_RECALL_VERBOSE === 'true';
    }

    /**
     * Main installation process
     */
    async install() {
        if (this.skipInstall) {
            console.log('🔄 Installation skipped (CLAUDE_RECALL_SKIP_INSTALL=true)');
            return;
        }

        console.log('');
        console.log('🎯 Claude Recall Installation');
        console.log('================================');
        console.log('');

        try {
            // Display system information if verbose
            if (this.verbose) {
                console.log('System Information:');
                console.log(JSON.stringify(this.platform.getSystemInfo(), null, 2));
                console.log('');
            }

            // Step 1: Initialize Claude Code integration
            await this.claude.initialize();
            console.log('');

            // Step 2: Install hook files
            await this.claude.installHooks();
            console.log('');

            // Step 3: Update Claude Code settings
            await this.claude.updateSettings();
            console.log('');

            // Step 4: Initialize database
            await this.claude.initializeDatabase();
            console.log('');

            // Step 5: Validate installation
            const isValid = await this.claude.validateInstallation();
            console.log('');

            if (isValid) {
                this.displaySuccessMessage();
            } else {
                this.displayPartialInstallMessage();
            }

        } catch (error) {
            this.displayErrorMessage(error);
            process.exit(1);
        }
    }

    /**
     * Display success message
     */
    displaySuccessMessage() {
        console.log('🎉 Installation Complete!');
        console.log('========================');
        console.log('');
        console.log('Claude Recall has been successfully installed and configured.');
        console.log('');
        console.log('Next steps:');
        console.log('1. Restart Claude Code to activate the hooks');
        console.log('2. Start using Claude Code - memories will be captured automatically');
        console.log('3. Use `claude-recall stats` to view captured memories');
        console.log('4. Use `claude-recall search <query>` to search your memories');
        console.log('');
        console.log('For help: `claude-recall --help`');
        console.log('For status: `claude-recall status`');
        console.log('');
    }

    /**
     * Display partial installation message
     */
    displayPartialInstallMessage() {
        console.log('⚠️  Partial Installation');
        console.log('========================');
        console.log('');
        console.log('Claude Recall was partially installed but some components may need manual setup.');
        console.log('');
        console.log('To check status: `claude-recall status`');
        console.log('To retry installation: `claude-recall install`');
        console.log('To validate setup: `claude-recall validate`');
        console.log('');
    }

    /**
     * Display error message
     */
    displayErrorMessage(error) {
        console.error('❌ Installation Failed');
        console.error('======================');
        console.error('');
        console.error('Error:', error.message);
        console.error('');
        console.error('Troubleshooting:');
        console.error('1. Ensure Claude Code is installed and accessible');
        console.error('2. Check that you have write permissions to ~/.claude/');
        console.error('3. Try running with verbose output: CLAUDE_RECALL_VERBOSE=true npm install');
        console.error('4. For manual installation, see the README.md');
        console.error('');
        console.error('To skip automatic installation: CLAUDE_RECALL_SKIP_INSTALL=true npm install');
        console.error('');
        
        if (this.verbose) {
            console.error('Full error details:');
            console.error(error.stack);
        }
    }
}

// Run installer if called directly
if (require.main === module) {
    const installer = new ClaudeRecallInstaller();
    installer.install();
}

module.exports = ClaudeRecallInstaller;