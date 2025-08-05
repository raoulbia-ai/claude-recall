export interface CorrectionPattern {
  original: string;
  corrected: string;
  context: string;
  frequency: number;
}

export class PatternDetector {
  detectCorrection(original: string, modified: string): CorrectionPattern | null {
    if (original === modified) return null;
    
    // Basic diff analysis
    const pattern = {
      original: this.extractPattern(original),
      corrected: this.extractPattern(modified),
      context: this.detectContext(original, modified),
      frequency: 1
    };
    
    return pattern;
  }
  
  private extractPattern(code: string): string {
    // Extract generalizable pattern
    // Process in order: strings first, then numbers, then identifiers
    let pattern = code;
    
    // Track positions of already replaced content to avoid double replacement
    const replacements: Array<{start: number, end: number, text: string}> = [];
    
    // Replace strings
    pattern = pattern.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (match, offset) => {
      replacements.push({start: offset, end: offset + match.length, text: 'STRING'});
      return 'STRING';
    });
    
    // Replace numbers (but not inside already replaced strings)
    pattern = pattern.replace(/\b\d+(?:\.\d+)?\b/g, 'NUMBER');
    
    // Replace identifiers, preserving keywords
    const keywords = ['function', 'const', 'let', 'var', 'return', 'if', 'else', 
                      'for', 'while', 'class', 'interface', 'type', 'import', 'export',
                      'STRING', 'NUMBER']; // Add our placeholders as keywords
    
    pattern = pattern.replace(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g, (match) => {
      if (keywords.includes(match)) {
        return match;
      }
      return 'IDENTIFIER';
    });
    
    return pattern;
  }
  
  private detectContext(original: string, modified: string): string {
    // Detect the type of change
    if (original.includes('function') || modified.includes('function')) {
      return 'function-declaration';
    }
    if (original.includes('const') || original.includes('let') || original.includes('var')) {
      return 'variable-declaration';
    }
    if (original.includes('(') && original.includes(')')) {
      return 'function-call';
    }
    return 'general';
  }
}