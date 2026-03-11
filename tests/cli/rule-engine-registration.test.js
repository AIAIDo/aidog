import { describe, it, expect } from 'vitest';
import { createRuleEngine, RuleEngine } from '../../src/rules/index.js';

describe('createRuleEngine', () => {
  it('registers 18 rules', () => {
    const engine = createRuleEngine();
    expect(engine.rules).toHaveLength(18);
  });

  it('bare RuleEngine has no rules', () => {
    const engine = new RuleEngine();
    expect(engine.rules).toHaveLength(0);
  });
});
