#!/usr/bin/env node
/**
 * Platform Utilities for Claude Recall NPM Installer
 * Handles cross-platform compatibility for file operations, paths, and permissions
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

class PlatformUtils {
    constructor() {
        this.platform = os.platform();
        this.isWindows = this.platform === 'win32';
        this.isMacOS = this.platform === 'darwin';
        this.isLinux = this.platform === 'linux';
        this.homeDir = os.homedir();
    }

    /**
     * Get the Claude Code directory path for the current platform
     */
    getClaudeDir() {
        return path.join(this.homeDir, '.claude');
    }

    /**
     * Get the Claude Code hooks directory path
     */
    getClaudeHooksDir() {
        return path.join(this.getClaudeDir(), 'hooks');
    }

    /**
     * Get the Claude Code settings.json path
     */
    getClaudeSettingsPath() {
        return path.join(this.getClaudeDir(), 'settings.json');
    }

    /**
     * Detect if Claude Code is installed by checking for the CLI
     */
    async detectClaudeCode() {
        const possibleCommands = ['claude', 'claude-code', 'code'];
        
        for (const cmd of possibleCommands) {
            try {
                if (this.isWindows) {
                    execSync(`where ${cmd}`, { stdio: 'ignore' });
                } else {
                    execSync(`which ${cmd}`, { stdio: 'ignore' });
                }
                return { found: true, command: cmd };
            } catch (error) {
                // Command not found, continue checking
            }
        }

        // Check for Claude Code installation in common paths
        const commonPaths = this.getCommonClaudePaths();
        for (const claudePath of commonPaths) {
            if (fs.existsSync(claudePath)) {
                return { found: true, path: claudePath };
            }
        }

        return { found: false };
    }

    /**
     * Get common installation paths for Claude Code
     */
    getCommonClaudePaths() {
        if (this.isWindows) {
            return [
                path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Claude', 'Claude.exe'),
                path.join(process.env.PROGRAMFILES || '', 'Claude', 'Claude.exe'),
                path.join(process.env['PROGRAMFILES(X86)'] || '', 'Claude', 'Claude.exe')
            ];
        } else if (this.isMacOS) {
            return [
                '/Applications/Claude.app',
                path.join(this.homeDir, 'Applications', 'Claude.app')
            ];
        } else {
            return [
                '/usr/local/bin/claude',
                '/usr/bin/claude',
                path.join(this.homeDir, '.local', 'bin', 'claude')
            ];
        }
    }

    /**
     * Create directory with proper permissions
     */
    async ensureDirectory(dirPath) {
        try {
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true, mode: this.isWindows ? undefined : 0o755 });
                console.log(`✓ Created directory: ${dirPath}`);
            } else {
                console.log(`✓ Directory exists: ${dirPath}`);
            }
            return true;
        } catch (error) {
            console.error(`✗ Failed to create directory ${dirPath}:`, error.message);
            return false;
        }
    }

    /**
     * Copy file with proper permissions
     */
    async copyFile(source, destination, executable = false) {
        try {
            fs.copyFileSync(source, destination);
            
            if (!this.isWindows && executable) {
                fs.chmodSync(destination, 0o755);
            }
            
            console.log(`✓ Copied ${path.basename(source)} to ${destination}`);
            return true;
        } catch (error) {
            console.error(`✗ Failed to copy ${source} to ${destination}:`, error.message);
            return false;
        }
    }

    /**
     * Make file executable (Unix-like systems only)
     */
    async makeExecutable(filePath) {
        if (this.isWindows) {
            return true; // Windows doesn't use Unix permissions
        }

        try {
            fs.chmodSync(filePath, 0o755);
            console.log(`✓ Made executable: ${filePath}`);
            return true;
        } catch (error) {
            console.error(`✗ Failed to make executable ${filePath}:`, error.message);
            return false;
        }
    }

    /**
     * Check if file exists and is readable
     */
    fileExists(filePath) {
        try {
            fs.accessSync(filePath, fs.constants.F_OK | fs.constants.R_OK);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Safely read JSON file
     */
    async readJsonFile(filePath) {
        try {
            if (!this.fileExists(filePath)) {
                return null;
            }
            const content = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            console.error(`✗ Failed to read JSON file ${filePath}:`, error.message);
            return null;
        }
    }

    /**
     * Safely write JSON file with backup
     */
    async writeJsonFile(filePath, data, createBackup = true) {
        try {
            // Create backup if file exists
            if (createBackup && this.fileExists(filePath)) {
                const backupPath = `${filePath}.backup.${Date.now()}`;
                fs.copyFileSync(filePath, backupPath);
                console.log(`✓ Created backup: ${backupPath}`);
            }

            const jsonString = JSON.stringify(data, null, 2);
            fs.writeFileSync(filePath, jsonString, 'utf8');
            console.log(`✓ Updated ${filePath}`);
            return true;
        } catch (error) {
            console.error(`✗ Failed to write JSON file ${filePath}:`, error.message);
            return false;
        }
    }

    /**
     * Get system information for debugging
     */
    getSystemInfo() {
        return {
            platform: this.platform,
            arch: os.arch(),
            nodeVersion: process.version,
            homeDir: this.homeDir,
            claudeDir: this.getClaudeDir(),
            isWindows: this.isWindows,
            isMacOS: this.isMacOS,
            isLinux: this.isLinux
        };
    }

    /**
     * Run command and capture output
     */
    async runCommand(command, options = {}) {
        return new Promise((resolve, reject) => {
            const child = spawn(command, [], {
                shell: true,
                stdio: options.stdio || 'pipe',
                ...options
            });

            let stdout = '';
            let stderr = '';

            if (child.stdout) {
                child.stdout.on('data', (data) => {
                    stdout += data.toString();
                });
            }

            if (child.stderr) {
                child.stderr.on('data', (data) => {
                    stderr += data.toString();
                });
            }

            child.on('close', (code) => {
                if (code === 0) {
                    resolve({ success: true, stdout, stderr });
                } else {
                    reject(new Error(`Command failed with code ${code}: ${stderr}`));
                }
            });

            child.on('error', (error) => {
                reject(error);
            });
        });
    }
}

module.exports = PlatformUtils;