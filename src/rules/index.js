import { RuleEngine } from './engine.js';
import R1 from './rules/R1-context-growth.js';
import R2 from './rules/R2-tool-loop.js';
import R3 from './rules/R3-large-output.js';
import R4 from './rules/R4-cache-hit.js';
import R5 from './rules/R5-mcp-overhead.js';
import R6 from './rules/R6-retry-loop.js';
import R7 from './rules/R7-file-reread.js';
import R8 from './rules/R8-large-file-read.js';
import R9 from './rules/R9-glob-abuse.js';
import R10 from './rules/R10-bash-truncation.js';
import R11 from './rules/R11-test-suite.js';
import R12 from './rules/R12-model-mismatch.js';
import R13 from './rules/R13-session-length.js';
import R14 from './rules/R14-search-wide.js';
import R15 from './rules/R15-io-ratio.js';
import R16 from './rules/R16-opencode-mcp-saturation.js';
import R17 from './rules/R17-gemini-low-output.js';
import R18 from './rules/R18-codex-o1-overhead.js';

const allRules = [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18];

export function createRuleEngine() {
  const engine = new RuleEngine();
  for (const rule of allRules) {
    engine.registerRule(rule);
  }
  return engine;
}

export { RuleEngine } from './engine.js';
export { allRules };
