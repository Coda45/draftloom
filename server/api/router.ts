import { Router, type Request } from 'express';
import multer from 'multer';
import type { ServerConfig } from '../config';
import { ApiError, asyncRoute } from './errors';
import { validateUpload } from './image';
import { fixedWindowRateLimit } from './rate-limit';
import { concurrencyLimit } from './concurrency';
import { ImportSessionStore } from '../upload/session-store';
import type { SketchVisionProvider } from '../ai/types';
import { validateSketchSemantics } from '../ai/validate-semantics';
import { parseCalibration, parseObservations } from '../reconstruction/observations';
import { reconstructFloorplan } from '../reconstruction/floorplan/reconstruct';

function bearer(req: Request): string {
    const header = req.get('authorization');
    if (!header?.startsWith('Bearer ') || header.length <= 7) throw new ApiError(401, 'SESSION_UNAUTHORIZED', 'A valid editor session token is required.');
    return header.slice(7);
}

function routeParam(value: string | string[]): string {
    return Array.isArray(value) ? value[0] : value;
}

function publicBase(req: Request, configured?: string): string {
    if (configured) return configured;
    const origin = req.get('origin');
    if (origin) {
        try {
            const url = new URL(origin);
            if ((url.protocol === 'http:' || url.protocol === 'https:') && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url.origin;
        } catch { /* Ignore untrusted malformed origins. */ }
    }
    return 'http://localhost:3001';
}

export function createApiRouter(options: { config: ServerConfig; sessions: ImportSessionStore; vision?: SketchVisionProvider }): Router {
    const { config, sessions, vision } = options;
    const router = Router();
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10 } });
    router.get('/health', (_req, res) => res.json({ ok: true, contractVersion: 1 }));

    router.post('/import-sessions', fixedWindowRateLimit(20, 60_000), (req, res) => {
        const created = sessions.create();
        res.status(201).json({ sessionId: created.sessionId, editorToken: created.editorToken, uploadUrl: `${publicBase(req, config.publicBaseUrl)}/upload/${created.uploadToken}`, expiresAt: created.expiresAt });
    });
    router.get('/import-sessions/:sessionId', (req, res) => {
        res.set('Cache-Control', 'no-store').json(sessions.status(routeParam(req.params.sessionId), bearer(req)));
    });
    router.get('/import-sessions/:sessionId/image', (req, res) => {
        const image = sessions.takeImage(routeParam(req.params.sessionId), bearer(req));
        res.set({ 'Cache-Control': 'no-store', 'Content-Type': image.mimeType, 'Content-Disposition': `inline; filename="${image.name.replace(/["\r\n]/g, '_')}"` }).send(image.bytes);
    });
    router.post('/import-sessions/upload/:uploadToken', fixedWindowRateLimit(10, 60_000), concurrencyLimit(4, 'UPLOAD_CAPACITY'), upload.single('file'), (req, res) => {
        sessions.upload(routeParam(req.params.uploadToken), validateUpload(req.file));
        res.status(201).json({ ok: true });
    });
    router.post('/reconstruct', fixedWindowRateLimit(10, 60_000), concurrencyLimit(config.maxAiConcurrency, 'RECONSTRUCTION_CAPACITY'), upload.single('file'), asyncRoute(async (req, res) => {
        const image = validateUpload(req.file);
        const mode = req.body.mode ?? 'auto';
        if (!['auto', 'floorplan', 'isometric'].includes(mode)) throw new ApiError(400, 'MODE_INVALID', 'Mode must be auto, floorplan, or isometric.');
        if (mode === 'isometric') throw new ApiError(422, 'ISOMETRIC_NOT_AVAILABLE', 'Isometric reconstruction is an optional module and is not enabled. Use floor-plan mode.');
        const observations = parseObservations(req.body.observations);
        const calibration = parseCalibration(req.body.calibration);
        let semantics;
        if (vision) {
            const unknownSemantics = await vision.analyzeSketch({ imageBytes: image.bytes, mimeType: image.mimeType, mode, promptContext: `${observations.wallSegments.length} line candidates and ${observations.colorComponents.length} colored components were measured by deterministic preprocessing.` });
            semantics = validateSketchSemantics(unknownSemantics);
            if (semantics.mode === 'isometric') throw new ApiError(422, 'ISOMETRIC_DETECTED', 'This drawing appears isometric. The isolated isometric module is not enabled; select a top-down floor plan.');
        }
        res.json(reconstructFloorplan({ image, observations, semantics, calibration }));
    }));
    return router;
}
