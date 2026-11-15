import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { ValidatedImage } from '../api/image';
import { ApiError } from '../api/errors';

export type ImportSessionStatus = 'waiting' | 'uploaded' | 'expired' | 'error';

interface ImportSession {
    id: string;
    editorToken: string;
    uploadToken: string | null;
    createdAt: number;
    expiresAt: number;
    image?: ValidatedImage;
    error?: string;
}

export interface CreatedImportSession {
    sessionId: string;
    editorToken: string;
    uploadToken: string;
    expiresAt: string;
}

export interface ImportSessionSummary {
    status: ImportSessionStatus;
    name?: string;
    mimeType?: string;
    expiresAt: string;
}

function token(): string {
    return randomBytes(32).toString('base64url');
}

function tokensEqual(actual: string, expected: string): boolean {
    const a = Buffer.from(actual);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

export class ImportSessionStore {
    private readonly sessions = new Map<string, ImportSession>();
    private readonly uploadTokens = new Map<string, string>();

    constructor(
        private readonly ttlMs: number,
        private readonly maxSessions: number,
        private readonly now: () => number = Date.now,
    ) {}

    create(): CreatedImportSession {
        this.cleanup();
        const activeSessions = [...this.sessions.values()].filter((session) => !this.isExpired(session)).length;
        if (activeSessions >= this.maxSessions) throw new ApiError(503, 'SESSION_CAPACITY', 'Too many import sessions are active. Try again shortly.', true);
        const id = token();
        const editorToken = token();
        const uploadToken = token();
        const createdAt = this.now();
        const session: ImportSession = { id, editorToken, uploadToken, createdAt, expiresAt: createdAt + this.ttlMs };
        this.sessions.set(id, session);
        this.uploadTokens.set(uploadToken, id);
        return { sessionId: id, editorToken, uploadToken, expiresAt: new Date(session.expiresAt).toISOString() };
    }

    status(sessionId: string, editorToken: string): ImportSessionSummary {
        const session = this.authorize(sessionId, editorToken);
        const expired = this.isExpired(session);
        return {
            status: expired ? 'expired' : session.error ? 'error' : session.image ? 'uploaded' : 'waiting',
            name: session.image?.name,
            mimeType: session.image?.mimeType,
            expiresAt: new Date(session.expiresAt).toISOString(),
        };
    }

    upload(uploadToken: string, image: ValidatedImage): void {
        const sessionId = this.uploadTokens.get(uploadToken);
        if (!sessionId) throw new ApiError(404, 'UPLOAD_TOKEN_INVALID', 'The upload link is invalid, expired, or already used.');
        const session = this.sessions.get(sessionId);
        if (!session || this.isExpired(session)) {
            this.uploadTokens.delete(uploadToken);
            throw new ApiError(410, 'SESSION_EXPIRED', 'This upload link has expired.');
        }
        if (!session.uploadToken || !tokensEqual(uploadToken, session.uploadToken) || session.image) {
            throw new ApiError(409, 'UPLOAD_ALREADY_USED', 'This upload link has already been used.');
        }
        session.image = image;
        session.uploadToken = null;
        this.uploadTokens.delete(uploadToken);
    }

    takeImage(sessionId: string, editorToken: string): ValidatedImage {
        const session = this.authorize(sessionId, editorToken);
        if (this.isExpired(session)) throw new ApiError(410, 'SESSION_EXPIRED', 'This import session has expired.');
        if (!session.image) throw new ApiError(409, 'IMAGE_NOT_READY', 'No phone image has been uploaded yet.', true);
        const image = session.image;
        if (session.uploadToken) this.uploadTokens.delete(session.uploadToken);
        this.sessions.delete(sessionId);
        return image;
    }

    cleanup(): void {
        const cutoff = this.now() - this.ttlMs;
        for (const [id, session] of this.sessions) {
            if (session.expiresAt > cutoff) continue;
            if (session.uploadToken) this.uploadTokens.delete(session.uploadToken);
            this.sessions.delete(id);
        }
    }

    get size(): number {
        return this.sessions.size;
    }

    private authorize(sessionId: string, editorToken: string): ImportSession {
        const session = this.sessions.get(sessionId);
        if (!session || !tokensEqual(editorToken, session.editorToken)) throw new ApiError(401, 'SESSION_UNAUTHORIZED', 'The editor session token is missing or invalid.');
        return session;
    }

    private isExpired(session: ImportSession): boolean {
        return this.now() >= session.expiresAt;
    }
}
