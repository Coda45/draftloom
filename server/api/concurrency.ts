import type { RequestHandler } from 'express';
import { ApiError } from './errors';

export function concurrencyLimit(limit: number, code: string): RequestHandler {
    let active = 0;
    return (_req, res, next) => {
        if (active >= limit) { next(new ApiError(503, code, 'The server is busy. Try again shortly.', true)); return; }
        active++;
        let released = false;
        const release = () => { if (!released) { released = true; active--; } };
        res.once('finish', release); res.once('close', release);
        next();
    };
}
