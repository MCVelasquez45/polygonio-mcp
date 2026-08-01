// Sliding-window in-memory IP rate limiter for /api/auth/* endpoints.
//
// Single long-running instance today (see ARCHITECTURE §8); swap the store for
// Redis when the API goes multi-instance. Style mirrors shared/ai/controls.ts.

import type { NextFunction, Request, Response } from 'express';
import { getIdentityConfig } from './config';

type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();

function clientKey(req: Request): string {
  // Trust the platform proxy's forwarded IP when present; fall back to socket.
  const forwarded = req.header('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0]!.trim() : req.ip || req.socket.remoteAddress || 'unknown';
  return ip;
}

function prune(bucket: Bucket, windowMs: number, now: number): void {
  const cutoff = now - windowMs;
  while (bucket.timestamps.length && bucket.timestamps[0]! < cutoff) {
    bucket.timestamps.shift();
  }
}

/** Express middleware factory. Optionally override the per-window max. */
export function authRateLimit(maxOverride?: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const cfg = getIdentityConfig();
    const windowMs = cfg.rateLimitWindowMs;
    const max = maxOverride ?? cfg.rateLimitMax;
    const now = Date.now();
    const key = clientKey(req);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      buckets.set(key, bucket);
    }
    prune(bucket, windowMs, now);
    if (bucket.timestamps.length >= max) {
      const retryAfterSec = Math.ceil((bucket.timestamps[0]! + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(Math.max(1, retryAfterSec)));
      res.status(429).json({ error: 'RATE_LIMITED' });
      return;
    }
    bucket.timestamps.push(now);
    next();
  };
}

/** Test helper: clears all rate-limit state. */
export function resetRateLimits(): void {
  buckets.clear();
}

// Opportunistic cleanup so idle keys don't accumulate forever.
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const cleanupTimer = setInterval(() => {
  const cfg = getIdentityConfig();
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    prune(bucket, cfg.rateLimitWindowMs, now);
    if (bucket.timestamps.length === 0) buckets.delete(key);
  }
}, CLEANUP_INTERVAL_MS);
// Don't keep the process alive for cleanup alone.
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
