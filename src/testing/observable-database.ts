import { MemoryService } from '../services/memory';

export interface DatabaseChange {
  operation: 'INSERT' | 'UPDATE' | 'DELETE' | 'SELECT';
  table: string;
  recordId?: string;
  oldValue?: any;
  newValue?: any;
  timestamp: number;
  sessionId?: string;
}

export class ObservableDatabase {
  private changes: DatabaseChange[] = [];
  private isTracking = false;
  private originalMethods: Map<string, Function> = new Map();
  
  constructor(private memoryService: MemoryService) {}
  
  startTracking(): void {
    if (this.isTracking) {
      return;
    }
    
    this.isTracking = true;
    this.changes = [];
    
    // Intercept memory service methods
    this.interceptMethod('store', this.trackStore.bind(this));
    this.interceptMethod('retrieve', this.trackRetrieve.bind(this));
    this.interceptMethod('search', this.trackSearch.bind(this));
    this.interceptMethod('update', this.trackUpdate.bind(this));
    this.interceptMethod('delete', this.trackDelete.bind(this));
  }
  
  stopTracking(): void {
    if (!this.isTracking) {
      return;
    }
    
    this.isTracking = false;
    
    // Restore original methods
    for (const [methodName, originalMethod] of this.originalMethods) {
      (this.memoryService as any)[methodName] = originalMethod;
    }
    this.originalMethods.clear();
  }
  
  getChanges(): DatabaseChange[] {
    return [...this.changes];
  }
  
  clearChanges(): void {
    this.changes = [];
  }
  
  getChangesSince(timestamp: number): DatabaseChange[] {
    return this.changes.filter(change => change.timestamp >= timestamp);
  }
  
  getChangesByOperation(operation: DatabaseChange['operation']): DatabaseChange[] {
    return this.changes.filter(change => change.operation === operation);
  }
  
  getChangesByTable(table: string): DatabaseChange[] {
    return this.changes.filter(change => change.table === table);
  }
  
  private interceptMethod(methodName: string, tracker: Function): void {
    const service = this.memoryService as any;
    
    if (!service[methodName]) {
      return;
    }
    
    // Store original method
    this.originalMethods.set(methodName, service[methodName]);
    
    // Replace with tracking wrapper
    service[methodName] = async (...args: any[]) => {
      const startTime = Date.now();
      const original = this.originalMethods.get(methodName)!;
      
      try {
        // Call original method
        const result = await original.apply(service, args);
        
        // Track the operation
        tracker(args, result, null);
        
        return result;
      } catch (error) {
        // Track the error
        tracker(args, null, error);
        throw error;
      }
    };
  }
  
  private trackStore(args: any[], result: any, error: any): void {
    if (!this.isTracking) return;
    
    const [request] = args;
    
    this.changes.push({
      operation: 'INSERT',
      table: 'memories',
      recordId: request?.key,
      newValue: request?.value,
      timestamp: Date.now(),
      sessionId: request?.context?.sessionId
    });
  }
  
  private trackRetrieve(args: any[], result: any, error: any): void {
    if (!this.isTracking) return;
    
    const [key] = args;
    
    this.changes.push({
      operation: 'SELECT',
      table: 'memories',
      recordId: key,
      newValue: result,
      timestamp: Date.now()
    });
  }
  
  private trackSearch(args: any[], result: any, error: any): void {
    if (!this.isTracking) return;
    
    const [query] = args;
    
    this.changes.push({
      operation: 'SELECT',
      table: 'memories',
      newValue: {
        query,
        resultCount: result?.length || 0
      },
      timestamp: Date.now()
    });
  }
  
  private trackUpdate(args: any[], result: any, error: any): void {
    if (!this.isTracking) return;
    
    const [key, updates] = args;
    
    this.changes.push({
      operation: 'UPDATE',
      table: 'memories',
      recordId: key,
      newValue: updates,
      timestamp: Date.now()
    });
  }
  
  private trackDelete(args: any[], result: any, error: any): void {
    if (!this.isTracking) return;
    
    const [key] = args;
    
    this.changes.push({
      operation: 'DELETE',
      table: 'memories',
      recordId: key,
      oldValue: result,
      timestamp: Date.now()
    });
  }
  
  // Analysis methods
  getStatistics(): {
    totalChanges: number;
    byOperation: Record<string, number>;
    byTable: Record<string, number>;
    averagePerMinute: number;
  } {
    const stats = {
      totalChanges: this.changes.length,
      byOperation: {} as Record<string, number>,
      byTable: {} as Record<string, number>,
      averagePerMinute: 0
    };
    
    if (this.changes.length === 0) {
      return stats;
    }
    
    // Count by operation
    for (const change of this.changes) {
      stats.byOperation[change.operation] = (stats.byOperation[change.operation] || 0) + 1;
      stats.byTable[change.table] = (stats.byTable[change.table] || 0) + 1;
    }
    
    // Calculate average per minute
    const firstChange = this.changes[0].timestamp;
    const lastChange = this.changes[this.changes.length - 1].timestamp;
    const durationMinutes = (lastChange - firstChange) / 60000;
    
    if (durationMinutes > 0) {
      stats.averagePerMinute = this.changes.length / durationMinutes;
    }
    
    return stats;
  }
  
  exportChanges(): string {
    return JSON.stringify(this.changes, null, 2);
  }
  
  importChanges(json: string): void {
    try {
      const imported = JSON.parse(json);
      if (Array.isArray(imported)) {
        this.changes = imported;
      }
    } catch (error) {
      console.error('Failed to import changes:', error);
    }
  }
}