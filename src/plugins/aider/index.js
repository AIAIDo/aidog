/**
 * Aider plugin stub for aidog.
 * Not yet implemented — returns isAvailable() = false.
 *
 * @implements {import('../interface.js').AgentPlugin}
 */
export class AiderPlugin {
  meta = {
    name: 'aider',
    displayName: 'Aider',
    version: '0.1.0',
    homepage: 'https://aider.chat',
  };

  async isAvailable() {
    return false;
  }

  async fetchHistory(_since) {
    return [];
  }

  watch(_callback) {
    return () => {};
  }

  async getCurrentSession() {
    return null;
  }
}
