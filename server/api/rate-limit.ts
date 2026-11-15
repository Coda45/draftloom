import type { RequestHandler } from 'express';
import { ApiError } from './errors';

interface Bucket {
    count: number;
    resetAt: number;
}

export function fixedWindowRateLimit(limit: number, windowMs: number): RequestHandler {
    const buckets = new Map<string, Bucket>();
    return (req, _res, next) => {
        const now = Date.now();
        const key = req.ip || req.socket.remoteAddress || 'unknown';
        const bucket = buckets.get(key);
        if (!bucket || now >= bucket.resetAt) {
            buckets.set(key, { count: 1, resetAt: now + windowMs });
            next();
            return;
        }
        bucket.count++;
        if (bucket.count > limit) {
            next(new ApiError(429, 'RATE_LIMITED', 'Too many requests. Try again shortly.', true));
            return;
        }
        next();
    };
}
