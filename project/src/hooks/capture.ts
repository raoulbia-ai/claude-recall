export interface HookEvent {
  type: string;
  tool_name: string;
  tool_input: any;
  timestamp: number;
  session_id: string;
}

export class HookCapture {
  private events: HookEvent[] = [];
  
  capture(event: HookEvent): void {
    this.events.push(event);
    console.log(`Captured: ${event.type} - ${event.tool_name}`);
  }
  
  getEvents(): HookEvent[] {
    return [...this.events];
  }
  
  clearEvents(): void {
    this.events = [];
  }
  
  getEventCount(): number {
    return this.events.length;
  }
}