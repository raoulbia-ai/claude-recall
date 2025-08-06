import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';

export class ClaudeJsonWatcher {
  private watcher?: fs.FSWatcher;
  private lastSize: number = 0;
  private lastProcessedPosition: number = 0;
  private claudeJsonPath: string;
  private isProcessing: boolean = false;
  private historyLengths: Map<string, number> = new Map();

  constructor() {
    this.claudeJsonPath = path.join(os.homedir(), '.claude.json');
  }

  start(): void {
    console.log(`[WATCHER] Starting watcher on ${this.claudeJsonPath}`);
    
    // Check if file exists
    if (!fs.existsSync(this.claudeJsonPath)) {
      console.error(`[WATCHER] ERROR: File not found: ${this.claudeJsonPath}`);
      return;
    }
    
    // Get initial file size and history lengths
    try {
      const stats = fs.statSync(this.claudeJsonPath);
      this.lastSize = stats.size;
      this.lastProcessedPosition = stats.size;
      console.log(`[WATCHER] Initial file size: ${this.lastSize} bytes`);
      
      // Read initial history lengths
      const fileContent = fs.readFileSync(this.claudeJsonPath, 'utf-8');
      const data = JSON.parse(fileContent);
      if (data.projects) {
        for (const projectPath in data.projects) {
          const project = data.projects[projectPath];
          if (project.history && Array.isArray(project.history)) {
            this.historyLengths.set(projectPath, project.history.length);
            console.log(`[WATCHER] Initial history length for ${projectPath}: ${project.history.length}`);
          }
        }
      }
    } catch (error) {
      console.error('[WATCHER] Error reading .claude.json:', error);
      return;
    }

    // Watch for changes
    this.watcher = fs.watch(this.claudeJsonPath, (eventType, filename) => {
      console.log(`[WATCHER] File event: ${eventType} (processing: ${this.isProcessing})`);
      if ((eventType === 'change' || eventType === 'rename') && !this.isProcessing) {
        // Small delay to ensure file write is complete
        setTimeout(() => this.handleFileChange(), 100);
      }
    });

    console.log('[WATCHER] Claude JSON watcher started successfully');
    console.log('[WATCHER] Monitoring for changes...');
  }

  private async handleFileChange(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const stats = fs.statSync(this.claudeJsonPath);
      const currentSize = stats.size;
      console.log(`[WATCHER] Checking file size: previous=${this.lastSize}, current=${currentSize}`);

      // Only process if file has grown
      if (currentSize > this.lastSize) {
        console.log(`[WATCHER] File grew by ${currentSize - this.lastSize} bytes`);
        
        // Read the new content
        const fileContent = fs.readFileSync(this.claudeJsonPath, 'utf-8');
        
        try {
          const data = JSON.parse(fileContent);
          
          // Check for new conversations or messages
          console.log(`[WATCHER] Found ${Object.keys(data.projects || {}).length} projects`);
          if (data.projects) {
            for (const projectPath in data.projects) {
              const project = data.projects[projectPath];
              console.log(`[WATCHER] Checking project: ${projectPath}`);
              if (project.history && Array.isArray(project.history)) {
                const currentLength = project.history.length;
                const previousLength = this.historyLengths.get(projectPath) || 0;
                console.log(`[WATCHER] Project has ${currentLength} history entries (previous: ${previousLength})`);
                
                // Check if there are new entries
                if (currentLength > previousLength) {
                  console.log(`[WATCHER] Found ${currentLength - previousLength} new entries!`);
                  // Process new entries
                  for (let i = previousLength; i < currentLength; i++) {
                    const entry = project.history[i];
                    console.log(`[WATCHER] Processing new entry ${i}:`, JSON.stringify(entry).substring(0, 200));
                    
                    // Capture the entry (even without timestamp)
                    await this.captureMemory(entry, projectPath);
                  }
                  
                  // Update the stored length
                  this.historyLengths.set(projectPath, currentLength);
                } else {
                  console.log('[WATCHER] No new entries detected');
                }
              } else {
                console.log('[WATCHER] No history array found');
              }
            }
          } else {
            console.log('[WATCHER] No projects found in data');
          }
        } catch (parseError) {
          console.error('Error parsing .claude.json:', parseError);
        }

        this.lastSize = currentSize;
      } else if (currentSize < this.lastSize) {
        console.log(`[WATCHER] File shrank (${this.lastSize} -> ${currentSize}), updating size`);
        this.lastSize = currentSize;
      } else {
        console.log('[WATCHER] File size unchanged');
      }
    } catch (error) {
      console.error('Error processing file change:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async captureMemory(entry: any, projectPath: string): Promise<void> {
    console.log('[WATCHER] Capturing memory for entry:', JSON.stringify(entry).substring(0, 200));
    
    // Extract the user prompt if available
    let content = '';
    if (entry.message) {
      content = entry.message;
      console.log('[WATCHER] Found content in entry.message');
    } else if (entry.content) {
      content = entry.content;
      console.log('[WATCHER] Found content in entry.content');
    } else if (entry.prompt) {
      content = entry.prompt;
      console.log('[WATCHER] Found content in entry.prompt');
    } else if (entry.display) {
      content = entry.display;
      console.log('[WATCHER] Found content in entry.display');
    }

    if (!content) {
      console.log('[WATCHER] WARNING: No content found in entry, checking all keys:', Object.keys(entry));
      return;
    }
    
    console.log(`[WATCHER] Content to capture: "${content.substring(0, 100)}..."`);

    // Prepare the event data
    const eventData = {
      content: content,
      timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now(),
      session_id: entry.sessionId || 'claude-json-watcher',
      project: projectPath
    };
    
    console.log('[WATCHER] Event data prepared:', JSON.stringify(eventData));

    // Call claude-recall capture
    console.log('[WATCHER] Spawning capture process...');
    const captureProcess = spawn('npx', ['claude-recall', 'capture', 'user-prompt'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Send the event data
    captureProcess.stdin.write(JSON.stringify(eventData));
    captureProcess.stdin.end();

    // Handle output
    captureProcess.stdout.on('data', (data) => {
      console.log('[WATCHER] Capture stdout:', data.toString().trim());
    });

    captureProcess.stderr.on('data', (data) => {
      console.error('[WATCHER] Capture stderr:', data.toString().trim());
    });

    captureProcess.on('close', (code) => {
      console.log(`[WATCHER] Capture process exited with code ${code}`);
      if (code === 0) {
        console.log('[WATCHER] Memory captured successfully!');
      } else {
        console.error('[WATCHER] Memory capture failed!');
      }
    });
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      console.log('Claude JSON watcher stopped');
    }
  }
}

// CLI entry point
if (require.main === module) {
  const watcher = new ClaudeJsonWatcher();
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nStopping watcher...');
    watcher.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    watcher.stop();
    process.exit(0);
  });

  // Start watching
  watcher.start();
  console.log('Watcher is running. Press Ctrl+C to stop.');
}