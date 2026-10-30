import { describe, expect, it, vi } from 'vitest';
import { backoffDelay, withRetry } from '../../src/shared/retry.js';

const opts = { attempts: 4, baseDelayMs: 100, maxDelayMs: 1_000 };

describe('backoffDelay', () => {
  it('grows exponentially and is capped', () => {
    const noJitter = () => 1;
    expect(backoffDelay(1, opts, noJitter)).toBe(100);
    expect(backoffDelay(2, opts, noJitter)).toBe(200);
    expect(backoffDelay(3, opts, noJitter)).toBe(400);
    expect(backoffDelay(10, opts, noJitter)).toBe(1_000);
  });

  it('applies jitter between half and the full ceiling', () => {
    expect(backoffDelay(3, opts, () => 0)).toBe(200);
  });
});

describe('withRetry', () => {
  it('retries retryable errors until success', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const fn = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(new Error('503'))
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValue('ok');
    await expect(withRetry(fn, () => true, { ...opts, sleep })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up after the configured attempts', async () => {
    const fn = vi.fn(() => Promise.reject(new Error('down')));
    await expect(
      withRetry(fn, () => true, { ...opts, sleep: () => Promise.resolve() }),
    ).rejects.toThrow('down');
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn(() => Promise.reject(new Error('bad request')));
    await expect(
      withRetry(fn, () => false, { ...opts, sleep: () => Promise.resolve() }),
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
