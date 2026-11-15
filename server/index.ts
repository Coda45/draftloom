import { pathToFileURL } from 'node:url';
import { createApp } from './app';
import { readConfig } from './config';
import { GeminiSketchVisionProvider } from './ai/gemini';
import { ImportSessionStore } from './upload/session-store';

export function startServer(): ReturnType<ReturnType<typeof createApp>['listen']> {
    const config = readConfig();
    const sessions = new ImportSessionStore(config.sessionTtlMs, config.maxSessions);
    const vision = config.geminiApiKey && config.geminiModel ? new GeminiSketchVisionProvider(config.geminiApiKey, config.geminiModel, config.maxAiConcurrency) : undefined;
    const app = createApp({ config, sessions, vision });
    const cleanup = setInterval(() => sessions.cleanup(), Math.min(config.sessionTtlMs, 60_000)); cleanup.unref();
    return app.listen(config.port, () => console.log(`Draftloom server listening on http://localhost:${config.port}${vision ? ' with AI interpretation' : ' without AI interpretation'}.`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer();
