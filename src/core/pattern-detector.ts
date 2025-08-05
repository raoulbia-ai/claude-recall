export interface DetectedPattern {
  taskType?: string;      // 'create_test', 'fix_bug', 'refactor', 'add_feature', etc.
  language?: string;      // 'typescript', 'python', 'javascript', etc.
  framework?: string;     // 'react', 'express', 'jest', etc.
  entities?: string[];    // Key entities mentioned (file names, function names, etc.)
}

export class PatternDetector {
  private taskTypePatterns: Map<string, RegExp[]>;
  private languageExtensions: Map<string, string>;
  private languageKeywords: Map<string, string[]>;
  private frameworkPatterns: Map<string, string[]>;

  constructor() {
    this.taskTypePatterns = this.initializeTaskTypePatterns();
    this.languageExtensions = this.initializeLanguageExtensions();
    this.languageKeywords = this.initializeLanguageKeywords();
    this.frameworkPatterns = this.initializeFrameworkPatterns();
  }

  detectPatterns(prompt: string): DetectedPattern {
    return {
      taskType: this.detectTaskType(prompt),
      language: this.detectLanguage(prompt),
      framework: this.detectFramework(prompt),
      entities: this.extractEntities(prompt)
    };
  }

  private detectTaskType(prompt: string): string | undefined {
    const lowerPrompt = prompt.toLowerCase();
    
    for (const [taskType, patterns] of this.taskTypePatterns) {
      for (const pattern of patterns) {
        if (pattern.test(lowerPrompt)) {
          return taskType;
        }
      }
    }
    
    return undefined;
  }

  private detectLanguage(prompt: string): string | undefined {
    const lowerPrompt = prompt.toLowerCase();
    
    // Check for file extensions
    const fileExtPattern = /\.(ts|js|py|java|go|rb|cpp|c|cs|php|swift|rs|kt|scala|r|m|h|mm|lua|dart|ex|exs|clj|hs|ml|jl|nim|zig)\b/gi;
    const matches = prompt.match(fileExtPattern);
    if (matches && matches.length > 0) {
      const extension = matches[0].substring(1).toLowerCase();
      return this.languageExtensions.get(extension);
    }
    
    // Check for explicit language names
    const languageNames = [
      { pattern: 'typescript', normalized: 'typescript' },
      { pattern: 'javascript', normalized: 'javascript' },
      { pattern: 'python', normalized: 'python' },
      { pattern: 'java', normalized: 'java' },
      { pattern: 'golang', normalized: 'go' },
      { pattern: 'go', normalized: 'go' },
      { pattern: 'ruby', normalized: 'ruby' },
      { pattern: 'c\\+\\+', normalized: 'cpp' },
      { pattern: 'cpp', normalized: 'cpp' },
      { pattern: 'c#', normalized: 'csharp' },
      { pattern: 'csharp', normalized: 'csharp' },
      { pattern: 'php', normalized: 'php' },
      { pattern: 'swift', normalized: 'swift' },
      { pattern: 'rust', normalized: 'rust' },
      { pattern: 'kotlin', normalized: 'kotlin' },
      { pattern: 'scala', normalized: 'scala' },
      { pattern: 'r', normalized: 'r' },
      { pattern: 'objective-c', normalized: 'objc' },
      { pattern: 'lua', normalized: 'lua' },
      { pattern: 'dart', normalized: 'dart' },
      { pattern: 'elixir', normalized: 'elixir' },
      { pattern: 'clojure', normalized: 'clojure' },
      { pattern: 'haskell', normalized: 'haskell' },
      { pattern: 'ocaml', normalized: 'ocaml' },
      { pattern: 'julia', normalized: 'julia' },
      { pattern: 'nim', normalized: 'nim' },
      { pattern: 'zig', normalized: 'zig' }
    ];
    
    for (const lang of languageNames) {
      // Special handling for patterns with special characters
      let regex;
      if (lang.pattern.includes('\\+') || lang.pattern.includes('#')) {
        // For C++ and C#, use space boundaries instead of word boundaries
        regex = new RegExp(`(^|\\s)${lang.pattern}(\\s|$)`, 'i');
      } else {
        regex = new RegExp(`\\b${lang.pattern}\\b`, 'i');
      }
      if (regex.test(prompt)) {
        return lang.normalized;
      }
    }
    
    // Check for language-specific keywords
    for (const [language, keywords] of this.languageKeywords) {
      for (const keyword of keywords) {
        if (lowerPrompt.includes(keyword)) {
          return language;
        }
      }
    }
    
    return undefined;
  }

  private detectFramework(prompt: string): string | undefined {
    const lowerPrompt = prompt.toLowerCase();
    
    for (const [framework, patterns] of this.frameworkPatterns) {
      for (const pattern of patterns) {
        if (lowerPrompt.includes(pattern.toLowerCase())) {
          return framework;
        }
      }
    }
    
    return undefined;
  }

  private extractEntities(prompt: string): string[] {
    const entities: string[] = [];
    
    // Extract file names (with extensions)
    const filePattern = /\b[\w.-]+\.\w+\b/g;
    const fileMatches = prompt.match(filePattern);
    if (fileMatches) {
      entities.push(...fileMatches);
    }
    
    // Extract function/method names (camelCase or snake_case followed by parentheses)
    const functionPattern = /\b[a-zA-Z_]\w*(?=\s*\()/g;
    const functionMatches = prompt.match(functionPattern);
    if (functionMatches) {
      entities.push(...functionMatches);
    }
    
    // Extract quoted strings
    const quotedPattern = /"([^"]+)"|'([^']+)'/g;
    let quotedMatch;
    while ((quotedMatch = quotedPattern.exec(prompt)) !== null) {
      entities.push(quotedMatch[1] || quotedMatch[2]);
    }
    
    // Extract module/component references (word + module/component)
    const modulePattern = /\b(\w+\s+(?:module|component|service|controller|middleware|flow|system|mechanism))\b/gi;
    const moduleMatches = prompt.match(modulePattern);
    if (moduleMatches) {
      entities.push(...moduleMatches);
    }
    
    // Extract class/module/component names (PascalCase)
    const pascalCasePattern = /\b[A-Z][a-zA-Z0-9]+(?:[A-Z][a-zA-Z0-9]+)*\b/g;
    const pascalMatches = prompt.match(pascalCasePattern);
    if (pascalMatches) {
      // Filter out common words that might match pattern but aren't entities
      const commonWords = ['The', 'This', 'That', 'These', 'Those', 'There', 'Here', 'When', 'Where', 'What', 'Which', 'Who', 'Why', 'How'];
      const filtered = pascalMatches.filter(match => !commonWords.includes(match));
      entities.push(...filtered);
    }
    
    // Remove duplicates and return
    return [...new Set(entities)];
  }

  private initializeTaskTypePatterns(): Map<string, RegExp[]> {
    return new Map([
      ['create_test', [
        /\b(create|write|add|make|generate)\s+(a\s+)?tests?\b/i,
        /\btest(s)?\s+for\b/i,
        /\bunit\s+test/i,
        /\btest\s+(case|suite|file)/i,
        /\b(write|add|create)\s+.*\s+test/i
      ]],
      ['fix_bug', [
        /\bfix(es|ed|ing)?\b/i,
        /\b(error|bug|issue|problem)\b/i,
        /\bnot\s+working\b/i,
        /\bbroken\b/i,
        /\b(resolve|debug|troubleshoot)/i,
        /\b(fails?|failing|failed)\b/i
      ]],
      ['refactor', [
        /\brefactor/i,
        /\bclean\s+up\b/i,
        /\b(improve|optimize|reorganize)\b/i,
        /\b(simplify|streamline)/i,
        /\brestructure/i
      ]],
      ['add_feature', [
        /\b(add|implement|create|build)\s+(?!test)/i,
        /\bnew\s+(feature|functionality|capability)/i,
        /\b(develop|introduce)\s+/i,
        /\bfeature\s+(request|implementation)/i
      ]],
      ['explain', [
        /\bexplain/i,
        /\bwhat\s+is\b/i,
        /\bhow\s+does\b/i,
        /\bwhy\s+(is|does|did)/i,
        /\bunderstand/i,
        /\bdescribe\s+(how|what|why)/i
      ]],
      ['review', [
        /\breview/i,
        /\bcheck\b.*\b(code|implementation|logic)/i,
        /\banalyze\b/i,
        /\baudit/i,
        /\b(evaluate|assess|inspect)/i,
        /\blook\s+over/i
      ]]
    ]);
  }

  private initializeLanguageExtensions(): Map<string, string> {
    return new Map([
      ['ts', 'typescript'],
      ['js', 'javascript'],
      ['py', 'python'],
      ['java', 'java'],
      ['go', 'go'],
      ['rb', 'ruby'],
      ['cpp', 'cpp'],
      ['c', 'c'],
      ['cs', 'csharp'],
      ['php', 'php'],
      ['swift', 'swift'],
      ['rs', 'rust'],
      ['kt', 'kotlin'],
      ['scala', 'scala'],
      ['r', 'r'],
      ['m', 'objc'],
      ['h', 'c'],
      ['mm', 'objc'],
      ['lua', 'lua'],
      ['dart', 'dart'],
      ['ex', 'elixir'],
      ['exs', 'elixir'],
      ['clj', 'clojure'],
      ['hs', 'haskell'],
      ['ml', 'ocaml'],
      ['jl', 'julia'],
      ['nim', 'nim'],
      ['zig', 'zig']
    ]);
  }

  private initializeLanguageKeywords(): Map<string, string[]> {
    return new Map([
      ['typescript', ['interface', 'type alias', ': string', ': number', ': boolean', 'implements', 'namespace']],
      ['javascript', ['async/await', 'promise', 'callback', 'arrow function', '=>']],
      ['python', ['def ', 'import from', 'self.', '__init__', 'pip install', 'django', 'flask']],
      ['java', ['public class', 'private void', 'public static', 'extends', 'implements', 'package ']],
      ['go', ['func ', 'package main', 'go mod', 'goroutine', 'channel']],
      ['rust', ['fn ', 'mut ', 'impl ', 'trait ', 'cargo']]
    ]);
  }

  private initializeFrameworkPatterns(): Map<string, string[]> {
    return new Map([
      ['react', ['component', 'jsx', 'useState', 'useEffect', 'props', 'render', 'React.', '<div>', '</div>']],
      ['express', ['router', 'middleware', 'app.get', 'app.post', 'req, res', 'express()', 'app.listen']],
      ['jest', ['describe', 'it(', 'expect', 'toBe', 'toEqual', 'mock', 'test(', 'beforeEach', 'afterEach']],
      ['vue', ['v-if', 'v-for', 'computed', 'mounted', 'data()', 'methods:', 'template:', 'Vue.']],
      ['django', ['models.py', 'views.py', 'urls.py', 'admin.py', 'Model', 'View', 'urlpatterns', 'django']]
    ]);
  }
}