import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ServerConfig {
    port: number;
    publicBaseUrl?: string;
    geminiApiKey?: string;
    geminiModel?: string;
    maxUploadBytes: number;
    sessionTtlMs: number;
    maxSessions: number;
    maxAiConcurrency: number;
}

let localEnvLoaded = false;

function loadLocalEnv(): void {
    if (localEnvLoaded) return;
    localEnvLoaded = true;
    const path = resolve('.env');
    if (!existsSync(path)) return;
    for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const equals = line.indexOf('=');
        if (equals <= 0) continue;
        const key = line.slice(0, equals).trim();
        let value = line.slice(equals + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        if (process.env[key] === undefined) process.env[key] = value;
    }
}

function positiveInt(value: string | undefined, fallback: number, name: string): number {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
    return parsed;
}

function optionalBaseUrl(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('PUBLIC_BASE_URL must use http or https.');
    if (url.username || url.password || url.search || url.hash) throw new Error('PUBLIC_BASE_URL must not contain credentials, query parameters, or a fragment.');
    return url.origin;
}

export function readConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
    loadLocalEnv();
    const geminiApiKey = process.env.GEMINI_API_KEY?.trim() || undefined;
    const geminiModel = process.env.GEMINI_MODEL?.trim() || undefined;
    if (geminiApiKey && !geminiModel) throw new Error('GEMINI_MODEL is required when GEMINI_API_KEY is configured.');
    return {
        port: overrides.port ?? positiveInt(process.env.PORT, 3001, 'PORT'),
        publicBaseUrl: overrides.publicBaseUrl ?? optionalBaseUrl(process.env.PUBLIC_BASE_URL),
        geminiApiKey: overrides.geminiApiKey ?? geminiApiKey,
        geminiModel: overrides.geminiModel ?? geminiModel,
        maxUploadBytes: overrides.maxUploadBytes ?? positiveInt(process.env.MAX_UPLOAD_BYTES, 12 * 1024 * 1024, 'MAX_UPLOAD_BYTES'),
        sessionTtlMs: overrides.sessionTtlMs ?? positiveInt(process.env.IMPORT_SESSION_TTL_MS, 10 * 60 * 1000, 'IMPORT_SESSION_TTL_MS'),
        maxSessions: overrides.maxSessions ?? positiveInt(process.env.MAX_IMPORT_SESSIONS, 100, 'MAX_IMPORT_SESSIONS'),
        maxAiConcurrency: overrides.maxAiConcurrency ?? positiveInt(process.env.MAX_AI_CONCURRENCY, 2, 'MAX_AI_CONCURRENCY'),
    };
}
