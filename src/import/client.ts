import type { ImportMode, ReconstructionResult } from '../shared/reconstruction-contract';
import type { ImageObservations } from './preprocess/types';

export interface ReconstructionCalibration { metersPerPixel?: number; originX?: number; originZ?: number; wallHeightM?: number }

export class ImportApiError extends Error {
    constructor(readonly code: string, message: string, readonly retryable: boolean, readonly status: number) { super(message); }
}

async function response<T>(request: Promise<Response>): Promise<T> {
    const result = await request;
    if (!result.ok) {
        const body = await result.json().catch(() => undefined) as { error?: { code?: string; message?: string; retryable?: boolean } } | undefined;
        throw new ImportApiError(body?.error?.code ?? 'REQUEST_FAILED', body?.error?.message ?? `Request failed with HTTP ${result.status}.`, body?.error?.retryable ?? result.status >= 500, result.status);
    }
    return result.json() as Promise<T>;
}

export interface ImportSession { sessionId: string; editorToken: string; uploadUrl: string; expiresAt: string }
export interface ImportSessionStatus { status: 'waiting' | 'uploaded' | 'expired' | 'error'; name?: string; mimeType?: string; expiresAt: string }

export function createImportSession(signal?: AbortSignal): Promise<ImportSession> {
    return response(fetch('/api/import-sessions', { method: 'POST', signal }));
}
export function getImportSession(session: ImportSession, signal?: AbortSignal): Promise<ImportSessionStatus> {
    return response(fetch(`/api/import-sessions/${encodeURIComponent(session.sessionId)}`, { headers: { Authorization: `Bearer ${session.editorToken}` }, signal, cache: 'no-store' }));
}
export async function takePhoneImage(session: ImportSession, signal?: AbortSignal): Promise<Blob> {
    const result = await fetch(`/api/import-sessions/${encodeURIComponent(session.sessionId)}/image`, { headers: { Authorization: `Bearer ${session.editorToken}` }, signal, cache: 'no-store' });
    if (!result.ok) await response(Promise.resolve(result));
    return result.blob();
}
export function uploadPhoneImage(token: string, file: Blob, signal?: AbortSignal): Promise<{ ok: true }> {
    const form = new FormData(); form.append('file', file, file instanceof File ? file.name : 'phone-photo.jpg');
    return response(fetch(`/api/import-sessions/upload/${encodeURIComponent(token)}`, { method: 'POST', body: form, signal }));
}
export function reconstructImage(file: Blob, mode: ImportMode, observations: ImageObservations, calibration?: ReconstructionCalibration, signal?: AbortSignal): Promise<ReconstructionResult> {
    const form = new FormData(); form.append('file', file, file instanceof File ? file.name : 'sketch.jpg'); form.append('mode', mode); form.append('observations', JSON.stringify(observations));
    if (calibration) form.append('calibration', JSON.stringify(calibration));
    return response(fetch('/api/reconstruct', { method: 'POST', body: form, signal }));
}
