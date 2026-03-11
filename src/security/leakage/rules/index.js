import { phoneRule } from './phone.js';
import { idCardRule } from './id-card.js';
import { bankCardRule } from './bank-card.js';
import { passwordRule } from './password.js';
import { serverLoginRule } from './server-login.js';
import { dbConnectionRule } from './db-connection.js';
import { apiKeyRule } from './api-key.js';
import { ipCredentialRule } from './ip-credential.js';
import { emailRule } from './email.js';
import { loadCustomRules } from './custom.js';

/** @type {import('../../types.js').SensitiveRule[]} */
export const builtInRules = [
  phoneRule,
  idCardRule,
  bankCardRule,
  passwordRule,
  serverLoginRule,
  dbConnectionRule,
  apiKeyRule,
  ipCredentialRule,
  emailRule,
];

/**
 * Get all rules (built-in + custom).
 * @returns {import('../../types.js').SensitiveRule[]}
 */
export function getAllRules() {
  return [...builtInRules, ...loadCustomRules()];
}
