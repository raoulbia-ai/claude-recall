import { LoggingService } from './logging';
import { Anthropic } from '@anthropic-ai/sdk';

export interface NLPAnalysis {
  intent: {
    type: 'preference' | 'correction' | 'query' | 'instruction' | 'other';
    confidence: number;
    subtype?: string;
  };
  entities: {
    subject: string;
    action: string;
    target?: string;
    modifiers?: string[];
  };
  preference?: {
    key: string;
    value: any;
    isOverride: boolean;
    temporal: 'permanent' | 'temporary' | 'session';
    reasoning: string;
  };
  context: {
    emotional_tone: 'neutral' | 'emphatic' | 'uncertain' | 'frustrated';
    formality: 'casual' | 'formal' | 'technical';
    urgency: 'low' | 'medium' | 'high';
  };
  confidence: number;
  reasoning: string;
}

export class ClaudeNLPAnalyzer {
  private logger = LoggingService.getInstance();
  private client: Anthropic;
  
  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY || ''
    });
  }

  /**
   * Analyze text using Claude's language understanding
   */
  async analyzeText(text: string, context?: any): Promise<NLPAnalysis> {
    try {
      const systemPrompt = `You are an NLP analyzer for a development assistant. Analyze user input to extract:
1. Intent (preference setting, correction, query, instruction)
2. Entities (subject, action, target)
3. If it's a preference: extract key, value, override status, and temporal scope
4. Context (tone, formality, urgency)

Respond in JSON format with the exact structure shown in the examples.

Examples:
User: "Let's put tests in tests-raoul from now on"
Response: {
  "intent": {"type": "preference", "confidence": 0.95, "subtype": "location"},
  "entities": {"subject": "tests", "action": "put", "target": "tests-raoul", "modifiers": ["from now on"]},
  "preference": {"key": "test_location", "value": "tests-raoul", "isOverride": true, "temporal": "permanent", "reasoning": "User explicitly states 'from now on' indicating a permanent preference change"},
  "context": {"emotional_tone": "neutral", "formality": "casual", "urgency": "medium"},
  "confidence": 0.95,
  "reasoning": "Clear preference statement with temporal modifier indicating permanent change"
}

User: "actually, use tabs instead"
Response: {
  "intent": {"type": "preference", "confidence": 0.9, "subtype": "style"},
  "entities": {"subject": "indentation", "action": "use", "target": "tabs", "modifiers": ["actually", "instead"]},
  "preference": {"key": "indentation", "value": "tabs", "isOverride": true, "temporal": "permanent", "reasoning": "Word 'actually' and 'instead' indicate changing from a previous preference"},
  "context": {"emotional_tone": "neutral", "formality": "casual", "urgency": "low"},
  "confidence": 0.9,
  "reasoning": "Override signal detected with 'actually' and 'instead', indicating preference change"
}`;

      const response = await this.client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 500,
        temperature: 0.2,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `Analyze this text: "${text}"\n\nContext: ${JSON.stringify(context || {})}`
        }]
      });

      const content = response.content[0];
      if (content.type === 'text') {
        try {
          const analysis = JSON.parse(content.text);
          
          this.logger.debug('ClaudeNLPAnalyzer', 'Analysis complete', {
            text: text.substring(0, 50) + '...',
            intent: analysis.intent,
            confidence: analysis.confidence
          });
          
          return analysis as NLPAnalysis;
        } catch (parseError) {
          this.logger.error('ClaudeNLPAnalyzer', 'Failed to parse Claude response', parseError as Error);
          return this.getFallbackAnalysis(text);
        }
      }
      
      return this.getFallbackAnalysis(text);
    } catch (error) {
      this.logger.logServiceError('ClaudeNLPAnalyzer', 'analyzeText', error as Error);
      return this.getFallbackAnalysis(text);
    }
  }

  /**
   * Batch analyze multiple texts
   */
  async analyzeBatch(texts: string[], context?: any): Promise<NLPAnalysis[]> {
    const results: NLPAnalysis[] = [];
    
    for (const text of texts) {
      const analysis = await this.analyzeText(text, context);
      results.push(analysis);
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return results;
  }

  /**
   * Extract semantic meaning from code corrections
   */
  async analyzeCodeCorrection(original: string, corrected: string): Promise<NLPAnalysis> {
    try {
      const prompt = `Analyze this code correction to understand the user's preference:

Original: ${original}
Corrected: ${corrected}

What coding style or preference is the user demonstrating?`;

      const response = await this.client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 300,
        temperature: 0.1,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const content = response.content[0];
      if (content.type === 'text') {
        // Parse the natural language response into structured preference
        return this.parseCodeCorrectionResponse(content.text, original, corrected);
      }
      
      return this.getFallbackAnalysis(`Code correction from ${original} to ${corrected}`);
    } catch (error) {
      this.logger.logServiceError('ClaudeNLPAnalyzer', 'analyzeCodeCorrection', error as Error);
      return this.getFallbackAnalysis(`Code correction`);
    }
  }

  /**
   * Understand context and relationships between preferences
   */
  async analyzePreferenceContext(preferences: any[], newText: string): Promise<{
    conflicts: string[];
    reinforcements: string[];
    suggestions: string[];
  }> {
    try {
      const prompt = `Given these existing preferences:
${preferences.map(p => `- ${p.key}: ${p.value}`).join('\n')}

And this new statement: "${newText}"

Analyze:
1. Any conflicts with existing preferences
2. Preferences that reinforce each other
3. Suggested related preferences

Respond in JSON format.`;

      const response = await this.client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 400,
        temperature: 0.3,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const content = response.content[0];
      if (content.type === 'text') {
        try {
          return JSON.parse(content.text);
        } catch {
          return { conflicts: [], reinforcements: [], suggestions: [] };
        }
      }
      
      return { conflicts: [], reinforcements: [], suggestions: [] };
    } catch (error) {
      this.logger.logServiceError('ClaudeNLPAnalyzer', 'analyzePreferenceContext', error as Error);
      return { conflicts: [], reinforcements: [], suggestions: [] };
    }
  }

  /**
   * Fallback analysis when API fails
   */
  private getFallbackAnalysis(text: string): NLPAnalysis {
    return {
      intent: {
        type: 'other',
        confidence: 0.1
      },
      entities: {
        subject: text,
        action: 'unknown'
      },
      context: {
        emotional_tone: 'neutral',
        formality: 'casual',
        urgency: 'low'
      },
      confidence: 0.1,
      reasoning: 'Fallback analysis due to API error'
    };
  }

  /**
   * Parse code correction response into structured format
   */
  private parseCodeCorrectionResponse(response: string, original: string, corrected: string): NLPAnalysis {
    // This would use more sophisticated parsing in production
    const analysis: NLPAnalysis = {
      intent: {
        type: 'correction',
        confidence: 0.8,
        subtype: 'code_style'
      },
      entities: {
        subject: 'code',
        action: 'correct',
        target: corrected,
        modifiers: []
      },
      context: {
        emotional_tone: 'neutral',
        formality: 'technical',
        urgency: 'low'
      },
      confidence: 0.8,
      reasoning: response
    };

    // Try to extract specific preferences from the response
    if (response.toLowerCase().includes('indentation')) {
      analysis.preference = {
        key: 'indentation',
        value: corrected.includes('\t') ? 'tabs' : `${corrected.match(/^ +/)?.[0].length || 2}_spaces`,
        isOverride: false,
        temporal: 'permanent',
        reasoning: 'Inferred from code correction'
      };
    }

    return analysis;
  }
}