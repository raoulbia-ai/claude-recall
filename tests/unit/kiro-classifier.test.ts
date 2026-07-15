/**
 * extractClassification parses kiro-cli's decorated stdout into a ClassifyResult.
 * kiro-cli wraps output in a `> ` marker, optional ```json fence, and ANSI
 * colour/cursor codes; the parser must recover the JSON without mangling the
 * payload (uppercase letters, hyphens in "project-knowledge", etc.).
 */
import { extractClassification } from '../../src/hooks/kiro-classifier';

const ESC = String.fromCharCode(27); // ESC

describe('extractClassification', () => {
  it('parses a plain JSON object with a leading prompt marker', () => {
    const out = '> {"type":"preference","confidence":0.9,"extract":"Favourite colour is green"}';
    expect(extractClassification(out)).toEqual({
      type: 'preference',
      confidence: 0.9,
      extract: 'Favourite colour is green',
    });
  });

  it('strips ANSI colour and cursor sequences around the JSON', () => {
    const out =
      `${ESC}[38;5;141m> ${ESC}[0m${ESC}[?25l` +
      '{"type":"correction","confidence":0.8,"extract":"Use tabs not spaces"}' +
      `${ESC}[0m`;
    expect(extractClassification(out)).toEqual({
      type: 'correction',
      confidence: 0.8,
      extract: 'Use tabs not spaces',
    });
  });

  it('handles a ```json markdown fence', () => {
    const out = '> ```json\n{"type":"devops","confidence":0.85,"extract":"Deploy via helm"}\n```';
    expect(extractClassification(out)).toEqual({
      type: 'devops',
      confidence: 0.85,
      extract: 'Deploy via helm',
    });
  });

  it('preserves uppercase and hyphens in the payload (no over-stripping)', () => {
    const out = '> {"type":"project-knowledge","confidence":0.7,"extract":"API uses OAuth2 with PKCE"}';
    expect(extractClassification(out)).toEqual({
      type: 'project-knowledge',
      confidence: 0.7,
      extract: 'API uses OAuth2 with PKCE',
    });
  });

  it('defaults confidence to 0.7 when the model omits it', () => {
    const out = '> {"type":"preference","extract":"Prefers dark mode"}';
    expect(extractClassification(out)).toEqual({
      type: 'preference',
      confidence: 0.7,
      extract: 'Prefers dark mode',
    });
  });

  it('passes through a valid precision grade', () => {
    const out = '> {"type":"preference","confidence":0.8,"extract":"Name documents so they sort together","precision":"vague"}';
    expect(extractClassification(out)).toMatchObject({ precision: 'vague' });
    const precise = '> {"type":"preference","confidence":0.9,"extract":"Use pnpm, not npm","precision":"precise"}';
    expect(extractClassification(precise)).toMatchObject({ precision: 'precise' });
  });

  it('omits precision when absent or invalid (older prompts, model drift)', () => {
    const absent = extractClassification('> {"type":"preference","confidence":0.9,"extract":"Use pnpm"}');
    expect(absent).not.toHaveProperty('precision');
    const invalid = extractClassification('> {"type":"preference","confidence":0.9,"extract":"Use pnpm","precision":"fuzzy"}');
    expect(invalid).not.toHaveProperty('precision');
  });

  it('returns null for type "none"', () => {
    expect(extractClassification('> {"type":"none","confidence":0,"extract":""}')).toBeNull();
  });

  it('returns null for an unknown type', () => {
    expect(extractClassification('> {"type":"banana","confidence":0.9,"extract":"x"}')).toBeNull();
  });

  it('returns null when extract is empty or whitespace', () => {
    expect(extractClassification('> {"type":"preference","confidence":0.9,"extract":"   "}')).toBeNull();
  });

  it('returns null when there is no JSON object', () => {
    expect(extractClassification('> I could not classify that.')).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    expect(extractClassification('> {"type":"preference", "extract": ')).toBeNull();
  });
});
