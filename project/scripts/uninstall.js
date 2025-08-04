#!/usr/bin/env node
/**
 * Claude Recall NPM Uninstaller
 * Clean removal of Claude Code integration
 */

const ClaudeIntegration = require('./claude-integration');

class ClaudeRecallUninstaller {
    constructor() {
        this.claude = new ClaudeIntegration();
        this.skipUninstall = process.env.CLAUDE_RECALL_SKIP_UNINSTALL === 'true';
    }

    /**
     * Main uninstallation process
     */
    async uninstall() {
        if (this.skipUninstall) {
            console.log('🔄 Uninstallation skipped (CLAUDE_RECALL_SKIP_UNINSTALL=true)');
            return;
        }

        console.log('');
        console.log('🗑️  Claude Recall Uninstallation');
        console.log('==================================');
        console.log('');

        try {
            const success = await this.claude.cleanup();
            
            if (success) {
                this.displaySuccessMessage();
            } else {
                this.displayPartialUninstallMessage();
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
        console.log('✅ Uninstallation Complete!');
        console.log('============================');
        console.log('');
        console.log('Claude Recall has been successfully removed from Claude Code.');
        console.log('');
        console.log('Note: The memory database (claude-recall.db) has been preserved');
        console.log('in case you want to reinstall later with your existing memories.');
        console.log('');
        console.log('To completely remove all data, manually delete:');
        console.log('- claude-recall.db (in the package directory)');
        console.log('- Any backup files created during installation');
        console.log('');
    }

    /**
     * Display partial uninstall message
     */
    displayPartialUninstallMessage() {
        console.log('⚠️  Partial Uninstallation');
        console.log('===========================');
        console.log('');
        console.log('Some components may need manual removal.');
        console.log('');
        console.log('Manual cleanup locations:');
        console.log('- ~/.claude/hooks/ (remove Claude Recall hook files)');
        console.log('- ~/.claude/settings.json (remove Claude Recall configuration)');
        console.log('');
    }

    /**
     * Display error message
     */
    displayErrorMessage(error) {
        console.error('❌ Uninstallation Failed');
        console.error('=========================');
        console.error('');
        console.error('Error:', error.message);
        console.error('');
        console.error('You may need to manually remove Claude Recall components:');
        console.error('1. Delete hook files from ~/.claude/hooks/');
        console.error('2. Remove Claude Recall entries from ~/.claude/settings.json');
        console.error('3. Delete claude-recall.db if desired');
        console.error('');
    }
}

// Run uninstaller if called directly
if (require.main === module) {
    const uninstaller = new ClaudeRecallUninstaller();
    uninstaller.uninstall();
}

module.exports = ClaudeRecallUninstaller;