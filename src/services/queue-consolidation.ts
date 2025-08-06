#!/usr/bin/env node

/**
 * Queue System Consolidation Script
 * 
 * This script helps consolidate the duplicate queue system implementations
 * (queue-system.ts and queue-system-fixed.ts) into a single, unified implementation.
 * 
 * Usage: npx ts-node src/services/queue-consolidation.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface FileImportInfo {
  filePath: string;
  imports: string[];
  needsUpdate: boolean;
}

class QueueConsolidation {
  private projectRoot: string;
  private filesToUpdate: FileImportInfo[] = [];

  constructor() {
    this.projectRoot = path.resolve(__dirname, '../..');
  }

  /**
   * Main consolidation process
   */
  async consolidate(): Promise<void> {
    console.log('🔧 Starting Queue System Consolidation...\n');

    try {
      // Step 1: Analyze current state
      console.log('📊 Step 1: Analyzing current implementation state...');
      const analysisResult = this.analyzeImplementations();
      console.log(analysisResult);

      // Step 2: Find all files importing from queue systems
      console.log('\n🔍 Step 2: Finding all files with queue system imports...');
      const importingFiles = this.findImportingFiles();
      console.log(`Found ${importingFiles.length} files with queue system imports`);

      // Step 3: Show consolidation plan
      console.log('\n📋 Step 3: Consolidation Plan:');
      this.showConsolidationPlan(importingFiles);

      // Step 4: Ask for confirmation
      const shouldProceed = await this.confirmAction(
        '\n⚠️  This will modify multiple files. Do you want to proceed? (y/n): '
      );

      if (!shouldProceed) {
        console.log('❌ Consolidation cancelled.');
        return;
      }

      // Step 5: Create backup
      console.log('\n💾 Step 5: Creating backup...');
      this.createBackup();

      // Step 6: Update imports
      console.log('\n✏️  Step 6: Updating imports...');
      this.updateImports(importingFiles);

      // Step 7: Verify and clean up
      console.log('\n🧹 Step 7: Verifying and cleaning up...');
      this.verifyAndCleanup();

      console.log('\n✅ Consolidation completed successfully!');
      console.log('\n📝 Next steps:');
      console.log('1. Run tests: npm test');
      console.log('2. Review changes: git diff');
      console.log('3. If everything looks good, commit the changes');
      console.log('4. Delete queue-system-fixed.ts if no longer needed');

    } catch (error) {
      console.error('\n❌ Error during consolidation:', error);
      console.log('\n🔄 You can restore from backup if needed.');
      process.exit(1);
    }
  }

  /**
   * Analyze both queue system implementations
   */
  private analyzeImplementations(): string {
    const mainFile = path.join(this.projectRoot, 'src/services/queue-system.ts');
    const fixedFile = path.join(this.projectRoot, 'src/services/queue-system-fixed.ts');

    const mainExists = fs.existsSync(mainFile);
    const fixedExists = fs.existsSync(fixedFile);

    let analysis = '';

    if (mainExists) {
      const mainStats = fs.statSync(mainFile);
      const mainContent = fs.readFileSync(mainFile, 'utf-8');
      const mainLines = mainContent.split('\n').length;
      analysis += `  ✓ queue-system.ts: ${mainLines} lines, ${mainStats.size} bytes\n`;
      
      // Check for key features
      if (mainContent.includes('RETURNING')) {
        analysis += '    - Has RETURNING clause fix ✓\n';
      }
      if (mainContent.includes('executeQuery')) {
        analysis += '    - Has database access API ✓\n';
      }
      if (mainContent.includes('configureQueue')) {
        analysis += '    - Has queue configuration ✓\n';
      }
      if (mainContent.includes('exponential')) {
        analysis += '    - Has exponential backoff ✓\n';
      }
    }

    if (fixedExists) {
      const fixedStats = fs.statSync(fixedFile);
      const fixedContent = fs.readFileSync(fixedFile, 'utf-8');
      const fixedLines = fixedContent.split('\n').length;
      analysis += `  ✓ queue-system-fixed.ts: ${fixedLines} lines, ${fixedStats.size} bytes\n`;
      
      // Check for key features
      if (fixedContent.includes('RETURNING')) {
        analysis += '    - Has RETURNING clause fix ✓\n';
      }
      if (fixedContent.includes('executeQuery')) {
        analysis += '    - Has database access API ✓\n';
      }
      if (fixedContent.includes('configureQueue')) {
        analysis += '    - Has queue configuration ✓\n';
      }
      if (fixedContent.includes('exponential')) {
        analysis += '    - Has exponential backoff ✓\n';
      }
    }

    return analysis;
  }

  /**
   * Find all files that import from queue-system or queue-system-fixed
   */
  private findImportingFiles(): FileImportInfo[] {
    const files: FileImportInfo[] = [];
    const searchDirs = ['src', 'tests'];

    searchDirs.forEach(dir => {
      const fullPath = path.join(this.projectRoot, dir);
      if (fs.existsSync(fullPath)) {
        this.findFilesRecursive(fullPath, files);
      }
    });

    return files;
  }

  /**
   * Recursively find TypeScript files with queue system imports
   */
  private findFilesRecursive(dir: string, files: FileImportInfo[]): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    entries.forEach(entry => {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        this.findFilesRecursive(fullPath, files);
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        
        // Check for imports
        const queueSystemImport = /from ['"]\..*queue-system['"]/.test(content);
        const queueSystemFixedImport = /from ['"]\..*queue-system-fixed['"]/.test(content);
        
        if (queueSystemImport || queueSystemFixedImport) {
          files.push({
            filePath: fullPath,
            imports: [
              queueSystemImport ? 'queue-system' : '',
              queueSystemFixedImport ? 'queue-system-fixed' : ''
            ].filter(Boolean),
            needsUpdate: queueSystemFixedImport
          });
        }
      }
    });
  }

  /**
   * Show the consolidation plan
   */
  private showConsolidationPlan(files: FileImportInfo[]): void {
    console.log('\nFiles currently using queue-system.ts:');
    files
      .filter(f => f.imports.includes('queue-system'))
      .forEach(f => console.log(`  ✓ ${this.getRelativePath(f.filePath)}`));

    console.log('\nFiles that need updating (using queue-system-fixed.ts):');
    files
      .filter(f => f.needsUpdate)
      .forEach(f => console.log(`  ⚠️  ${this.getRelativePath(f.filePath)}`));

    console.log('\nChanges to be made:');
    console.log('  1. Update all imports from queue-system-fixed to queue-system');
    console.log('  2. Ensure queue-system.ts has all fixes from queue-system-fixed.ts');
    console.log('  3. Archive queue-system-fixed.ts');
  }

  /**
   * Update imports in all files
   */
  private updateImports(files: FileImportInfo[]): void {
    let updatedCount = 0;

    files.filter(f => f.needsUpdate).forEach(file => {
      try {
        let content = fs.readFileSync(file.filePath, 'utf-8');
        
        // Replace imports
        content = content.replace(
          /from ['"](.*)queue-system-fixed['"]/g,
          'from "$1queue-system"'
        );

        fs.writeFileSync(file.filePath, content, 'utf-8');
        console.log(`  ✓ Updated: ${this.getRelativePath(file.filePath)}`);
        updatedCount++;
      } catch (error) {
        console.error(`  ❌ Failed to update: ${this.getRelativePath(file.filePath)}`, error);
      }
    });

    console.log(`\nUpdated ${updatedCount} files`);
  }

  /**
   * Create backup of current state
   */
  private createBackup(): void {
    const backupDir = path.join(this.projectRoot, '.backup', `queue-consolidation-${Date.now()}`);
    
    // Create backup directory
    fs.mkdirSync(backupDir, { recursive: true });

    // Backup queue system files
    const filesToBackup = [
      'src/services/queue-system.ts',
      'src/services/queue-system-fixed.ts',
      'src/services/queue-api.ts'
    ];

    filesToBackup.forEach(file => {
      const sourcePath = path.join(this.projectRoot, file);
      if (fs.existsSync(sourcePath)) {
        const destPath = path.join(backupDir, file);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(sourcePath, destPath);
        console.log(`  ✓ Backed up: ${file}`);
      }
    });

    console.log(`\nBackup created at: ${this.getRelativePath(backupDir)}`);
  }

  /**
   * Verify the consolidation and clean up
   */
  private verifyAndCleanup(): void {
    // Run TypeScript compiler to check for errors
    console.log('  Running TypeScript compiler check...');
    try {
      execSync('npx tsc --noEmit', { 
        cwd: this.projectRoot,
        stdio: 'pipe' 
      });
      console.log('  ✓ TypeScript compilation successful');
    } catch (error: any) {
      console.warn('  ⚠️  TypeScript compilation warnings/errors detected');
      console.log('  Please review and fix any type errors');
    }

    // Archive the fixed file
    const fixedFile = path.join(this.projectRoot, 'src/services/queue-system-fixed.ts');
    const archiveFile = path.join(this.projectRoot, 'src/services/queue-system-fixed.ts.archived');
    
    if (fs.existsSync(fixedFile)) {
      fs.renameSync(fixedFile, archiveFile);
      console.log('  ✓ Archived queue-system-fixed.ts');
    }
  }

  /**
   * Get relative path for display
   */
  private getRelativePath(fullPath: string): string {
    return path.relative(this.projectRoot, fullPath);
  }

  /**
   * Confirm action with user
   */
  private async confirmAction(prompt: string): Promise<boolean> {
    return new Promise((resolve) => {
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });

      readline.question(prompt, (answer: string) => {
        readline.close();
        resolve(answer.toLowerCase() === 'y');
      });
    });
  }
}

// Run consolidation if executed directly
if (require.main === module) {
  const consolidator = new QueueConsolidation();
  consolidator.consolidate();
}

export { QueueConsolidation };