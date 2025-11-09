import * as fs from 'fs';
import * as path from 'path';
import { LoggingService } from './logging';
import { ConfigService } from './config';

/**
 * Project Registry Entry
 */
export interface ProjectRegistryEntry {
  path: string;
  registeredAt: string; // ISO timestamp
  version: string;
  lastSeen: string; // ISO timestamp
}

/**
 * Project Registry Format
 */
export interface ProjectRegistryData {
  version: number;
  projects: Record<string, ProjectRegistryEntry>;
}

/**
 * ProjectRegistry
 *
 * Manages a registry of projects that have claude-recall installed.
 * Stored in ~/.claude-recall/projects.json
 *
 * Features:
 * - Auto-registration on MCP server start
 * - Manual registration via CLI commands
 * - Discovery of registered projects
 * - Cleanup of stale entries
 */
export class ProjectRegistry {
  private static instance: ProjectRegistry;
  private logger: LoggingService;
  private registryPath: string;

  private constructor() {
    this.logger = LoggingService.getInstance();
    const config = ConfigService.getInstance();
    const baseDir = path.dirname(config.getDatabasePath());
    this.registryPath = path.join(baseDir, 'projects.json');
  }

  static getInstance(): ProjectRegistry {
    if (!ProjectRegistry.instance) {
      ProjectRegistry.instance = new ProjectRegistry();
    }
    return ProjectRegistry.instance;
  }

  /**
   * Read the project registry from disk
   */
  private readRegistry(): ProjectRegistryData {
    if (!fs.existsSync(this.registryPath)) {
      return { version: 1, projects: {} };
    }

    try {
      const content = fs.readFileSync(this.registryPath, 'utf-8');
      const data = JSON.parse(content) as ProjectRegistryData;

      // Validate structure
      if (typeof data.version !== 'number' || typeof data.projects !== 'object') {
        this.logger.warn('ProjectRegistry', 'Invalid registry format, resetting');
        return { version: 1, projects: {} };
      }

      return data;
    } catch (error) {
      this.logger.error('ProjectRegistry', `Failed to read registry: ${error}`);
      return { version: 1, projects: {} };
    }
  }

  /**
   * Write the project registry to disk atomically
   */
  private writeRegistry(data: ProjectRegistryData): void {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.registryPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Atomic write: temp file + rename
      const tempPath = `${this.registryPath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.registryPath);

      this.logger.debug('ProjectRegistry', `Wrote registry with ${Object.keys(data.projects).length} projects`);
    } catch (error) {
      this.logger.error('ProjectRegistry', `Failed to write registry: ${error}`);
      throw error;
    }
  }

  /**
   * Register a project in the registry
   * @param projectId Project identifier (usually directory basename)
   * @param projectPath Absolute path to project directory
   * @param version Claude Recall version
   */
  register(projectId: string, projectPath: string, version: string): void {
    try {
      const registry = this.readRegistry();
      const now = new Date().toISOString();

      // Check if already registered
      const existing = registry.projects[projectId];
      if (existing && existing.path === projectPath) {
        // Already registered, just update version and lastSeen
        registry.projects[projectId].version = version;
        registry.projects[projectId].lastSeen = now;
        this.logger.debug('ProjectRegistry', `Updated existing project: ${projectId}`);
      } else {
        // New registration
        registry.projects[projectId] = {
          path: projectPath,
          registeredAt: now,
          version: version,
          lastSeen: now
        };
        this.logger.info('ProjectRegistry', `Registered new project: ${projectId} at ${projectPath}`);
      }

      this.writeRegistry(registry);
    } catch (error) {
      this.logger.error('ProjectRegistry', `Failed to register project ${projectId}: ${error}`);
      // Don't throw - registration failure shouldn't break MCP server startup
    }
  }

  /**
   * Unregister a project from the registry
   */
  unregister(projectId: string): boolean {
    try {
      const registry = this.readRegistry();

      if (!registry.projects[projectId]) {
        this.logger.warn('ProjectRegistry', `Project not found: ${projectId}`);
        return false;
      }

      delete registry.projects[projectId];
      this.writeRegistry(registry);

      this.logger.info('ProjectRegistry', `Unregistered project: ${projectId}`);
      return true;
    } catch (error) {
      this.logger.error('ProjectRegistry', `Failed to unregister project ${projectId}: ${error}`);
      return false;
    }
  }

  /**
   * Update lastSeen timestamp for a project
   */
  updateLastSeen(projectId: string): void {
    try {
      const registry = this.readRegistry();

      if (!registry.projects[projectId]) {
        this.logger.debug('ProjectRegistry', `Cannot update lastSeen for unknown project: ${projectId}`);
        return;
      }

      registry.projects[projectId].lastSeen = new Date().toISOString();
      this.writeRegistry(registry);
    } catch (error) {
      this.logger.error('ProjectRegistry', `Failed to update lastSeen for ${projectId}: ${error}`);
      // Don't throw - this is non-critical
    }
  }

  /**
   * Get all registered projects
   */
  list(): Array<{ projectId: string; entry: ProjectRegistryEntry }> {
    const registry = this.readRegistry();
    return Object.entries(registry.projects).map(([projectId, entry]) => ({
      projectId,
      entry
    }));
  }

  /**
   * Get a specific project entry
   */
  get(projectId: string): ProjectRegistryEntry | null {
    const registry = this.readRegistry();
    return registry.projects[projectId] || null;
  }

  /**
   * Clean stale registry entries (not seen in X days)
   * @param daysOld Number of days without activity to consider stale
   * @param dryRun If true, don't actually remove entries
   * @returns Number of entries that would be/were removed
   */
  clean(daysOld: number = 30, dryRun: boolean = false): number {
    try {
      const registry = this.readRegistry();
      const now = Date.now();
      const cutoff = now - (daysOld * 24 * 60 * 60 * 1000);
      let removed = 0;

      for (const [projectId, entry] of Object.entries(registry.projects)) {
        const lastSeenTime = new Date(entry.lastSeen).getTime();

        if (lastSeenTime < cutoff) {
          if (dryRun) {
            this.logger.info('ProjectRegistry', `[DRY RUN] Would remove stale project: ${projectId} (last seen: ${entry.lastSeen})`);
          } else {
            this.logger.info('ProjectRegistry', `Removing stale project: ${projectId} (last seen: ${entry.lastSeen})`);
            delete registry.projects[projectId];
          }
          removed++;
        }
      }

      if (!dryRun && removed > 0) {
        this.writeRegistry(registry);
      }

      return removed;
    } catch (error) {
      this.logger.error('ProjectRegistry', `Failed to clean registry: ${error}`);
      return 0;
    }
  }

  /**
   * Get the registry file path (for debugging/inspection)
   */
  getRegistryPath(): string {
    return this.registryPath;
  }
}
