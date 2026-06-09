import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Process-level smoke test for the stdio entrypoint.
 *
 * The MCP stdio transport reserves stdout exclusively for JSON-RPC framing, so
 * a misconfigured startup must fail on stderr with a non-zero exit and leave
 * stdout completely empty. The protocol-level tests use an in-memory transport
 * and so cannot catch stdout pollution at the real process boundary; this boots
 * the actual `src/index.ts` to cover that contract.
 */
describe('index.ts stdio entrypoint', () => {
  it('fails loud on stderr with empty stdout and non-zero exit when DATABASE_URL is unset', () => {
    const entry = fileURLToPath(new URL('./index.ts', import.meta.url));
    const tsx = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));

    const result = spawnSync(tsx, [entry], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: '' },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('DATABASE_URL');
  });
});
