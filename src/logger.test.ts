import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger.js';

function captureStderr(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const spy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      calls.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
  return { calls, restore: () => spy.mockRestore() };
}

describe('createLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes to stderr at or below the configured level', () => {
    const { calls, restore } = captureStderr();
    const logger = createLogger('info');

    logger.error('boom');
    logger.info('fyi');
    logger.debug('verbose');

    expect(calls.join('')).toContain('boom');
    expect(calls.join('')).toContain('fyi');
    expect(calls.join('')).not.toContain('verbose');
    restore();
  });

  it('silent level emits nothing', () => {
    const { calls, restore } = captureStderr();
    const logger = createLogger('silent');

    logger.error('boom');
    logger.info('fyi');
    logger.debug('verbose');

    expect(calls).toHaveLength(0);
    restore();
  });

  it('never writes to stdout', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write');
    const logger = createLogger('debug');

    logger.error('a');
    logger.info('b');
    logger.debug('c');

    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
