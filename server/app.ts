import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ServerConfig } from './config';
import { createApiRouter } from './api/router';
import { errorHandler, notFound } from './api/errors';
import { ImportSessionStore } from './upload/session-store';
import type { SketchVisionProvider } from './ai/types';

export function createApp(options: { config: ServerConfig; vision?: SketchVisionProvider; sessions?: ImportSessionStore }): Express {
    const app = express();
    const sessions = options.sessions ?? new ImportSessionStore(options.config.sessionTtlMs, options.config.maxSessions);
    app.disable('x-powered-by');
    app.use((_req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(self)', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'" }); next(); });
    app.use('/api', createApiRouter({ config: options.config, sessions, vision: options.vision }));
    const dist = resolve('dist');
    if (existsSync(dist)) {
        app.use(express.static(dist, { index: false }));
        app.use((req, res, next) => req.method === 'GET' && req.accepts('html') ? res.sendFile(resolve(dist, 'index.html')) : next());
    }
    app.use(notFound);
    app.use(errorHandler);
    return app;
}
