import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LoggingService } from './logging';
import { ConfigService } from './config';

/**
 * ProcessManager
 *
 * Manages MCP server process lifecycle:
 * - PID file management (write/read/validate/remove)
 * - Process detection and validation
 * - Cleanup of stale processes and PID files
 * - Cross-platform process management
 */
export class ProcessManager {
  private static instance: ProcessManager;
  private logger: LoggingService;
  private config: ConfigService;
  private pidDir: string;

  private constructor() {
    this.logger = LoggingService.getInstance();
    this.config = ConfigService.getInstance();

    // PID files stored in ~/.claude-recall/pids/
    const baseDir = path.dirname(this.config.getDatabasePath());
    this.pidDir = path.join(baseDir, 'pids');

    // Ensure PID directory exists
    if (!fs.existsSync(this.pidDir)) {
      fs.mkdirSync(this.pidDir, { recursive: true });
    }
  }

  static getInstance(): ProcessManager {
    if (!ProcessManager.instance) {
      ProcessManager.instance = new ProcessManager();
    }
    return ProcessManager.instance;
  }

  /**
   * Get PID file path for a project
   */
  private getPidFilePath(projectId: string): string {
    // Sanitize project ID for filename (replace unsafe chars)
    const safeName = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.pidDir, `mcp-${safeName}.pid`);
  }

  /**
   * Write PID file for current process
   */
  writePidFile(projectId: string, pid: number): void {
    const pidFile = this.getPidFilePath(projectId);
    try {
      fs.writeFileSync(pidFile, pid.toString(), 'utf-8');
      this.logger.debug('ProcessManager', `Wrote PID file: ${pidFile} (PID: ${pid})`);
    } catch (error) {
      this.logger.error('ProcessManager', `Failed to write PID file: ${error}`);
      throw error;
    }
  }

  /**
   * Read PID from file
   * Returns null if file doesn't exist or is invalid
   */
  readPidFile(projectId: string): number | null {
    const pidFile = this.getPidFilePath(projectId);

    if (!fs.existsSync(pidFile)) {
      return null;
    }

    try {
      const content = fs.readFileSync(pidFile, 'utf-8').trim();
      const pid = parseInt(content, 10);

      if (isNaN(pid) || pid <= 0) {
        this.logger.warn('ProcessManager', `Invalid PID in file: ${pidFile}`);
        return null;
      }

      return pid;
    } catch (error) {
      this.logger.error('ProcessManager', `Failed to read PID file: ${error}`);
      return null;
    }
  }

  /**
   * Check if a process is running (cross-platform)
   * Uses process.kill(pid, 0) which doesn't actually kill, just checks existence
   */
  isProcessRunning(pid: number): boolean {
    try {
      // Signal 0 checks if process exists without killing it
      process.kill(pid, 0);
      return true;
    } catch (error: any) {
      // ESRCH = process doesn't exist
      // EPERM = process exists but we don't have permission (still running)
      if (error.code === 'EPERM') {
        return true; // Process exists, just no permission
      }
      return false;
    }
  }

  /**
   * Kill a process
   * @param pid Process ID to kill
   * @param force If true, use SIGKILL (force kill). If false, use SIGTERM (graceful)
   */
  killProcess(pid: number, force: boolean = false): boolean {
    try {
      const signal = force ? 'SIGKILL' : 'SIGTERM';
      process.kill(pid, signal);
      this.logger.info('ProcessManager', `Sent ${signal} to process ${pid}`);
      return true;
    } catch (error: any) {
      if (error.code === 'ESRCH') {
        this.logger.warn('ProcessManager', `Process ${pid} not found`);
        return false;
      }
      this.logger.error('ProcessManager', `Failed to kill process ${pid}: ${error}`);
      throw error;
    }
  }

  /**
   * Remove PID file
   */
  removePidFile(projectId: string): void {
    const pidFile = this.getPidFilePath(projectId);

    if (fs.existsSync(pidFile)) {
      try {
        fs.unlinkSync(pidFile);
        this.logger.debug('ProcessManager', `Removed PID file: ${pidFile}`);
      } catch (error) {
        this.logger.error('ProcessManager', `Failed to remove PID file: ${error}`);
      }
    }
  }

  /**
   * Get all running MCP servers across all projects
   * Returns array of {projectId, pid, pidFile, isRunning}
   */
  getAllRunningServers(): Array<{projectId: string; pid: number; pidFile: string; isRunning: boolean}> {
    const servers: Array<{projectId: string; pid: number; pidFile: string; isRunning: boolean}> = [];

    if (!fs.existsSync(this.pidDir)) {
      return servers;
    }

    try {
      const files = fs.readdirSync(this.pidDir);

      for (const file of files) {
        if (!file.startsWith('mcp-') || !file.endsWith('.pid')) {
          continue;
        }

        // Extract project ID from filename (mcp-{projectId}.pid)
        const projectId = file.slice(4, -4).replace(/_/g, '/'); // Reverse sanitization
        const pidFile = path.join(this.pidDir, file);
        const pid = this.readPidFile(projectId);

        if (pid !== null) {
          const isRunning = this.isProcessRunning(pid);
          servers.push({ projectId, pid, pidFile, isRunning });
        }
      }
    } catch (error) {
      this.logger.error('ProcessManager', `Failed to list PID files: ${error}`);
    }

    return servers;
  }

  /**
   * Clean up stale PID files (files where process is not running)
   * Returns number of files cleaned up
   */
  cleanupStalePidFiles(dryRun: boolean = false): number {
    const servers = this.getAllRunningServers();
    let cleaned = 0;

    for (const server of servers) {
      if (!server.isRunning) {
        if (dryRun) {
          this.logger.info('ProcessManager', `[DRY RUN] Would remove: ${server.pidFile} (PID: ${server.pid})`);
        } else {
          this.logger.info('ProcessManager', `Removing stale PID file: ${server.pidFile} (PID: ${server.pid})`);
          this.removePidFile(server.projectId);
        }
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Stop all running MCP servers
   * Returns number of processes stopped
   */
  stopAllServers(dryRun: boolean = false, force: boolean = false): number {
    const servers = this.getAllRunningServers();
    let stopped = 0;

    for (const server of servers) {
      if (server.isRunning) {
        if (dryRun) {
          this.logger.info('ProcessManager', `[DRY RUN] Would stop: ${server.projectId} (PID: ${server.pid})`);
        } else {
          this.logger.info('ProcessManager', `Stopping MCP server: ${server.projectId} (PID: ${server.pid})`);
          this.killProcess(server.pid, force);
          this.removePidFile(server.projectId);
        }
        stopped++;
      }
    }

    return stopped;
  }

  /**
   * Get status of MCP server for a specific project
   */
  getServerStatus(projectId: string): {
    isRunning: boolean;
    pid: number | null;
    pidFile: string;
  } {
    const pidFile = this.getPidFilePath(projectId);
    const pid = this.readPidFile(projectId);
    const isRunning = pid !== null && this.isProcessRunning(pid);

    return { isRunning, pid, pidFile };
  }
}
