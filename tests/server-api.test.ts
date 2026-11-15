import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
import type { ServerConfig } from '../server/config';
import type { SketchVisionProvider } from '../server/ai/types';

const servers: Server[] = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const config: ServerConfig = { port: 0, publicBaseUrl: 'https://example.test', maxUploadBytes: 1024 * 1024, sessionTtlMs: 60_000, maxSessions: 10, maxAiConcurrency: 1 };

async function server(vision?: SketchVisionProvider): Promise<string> {
    const instance = createApp({ config, vision }).listen(0); servers.push(instance); await new Promise<void>((resolve) => instance.once('listening', resolve));
    const address = instance.address(); if (!address || typeof address === 'string') throw new Error('No test port.'); return `http://127.0.0.1:${address.port}`;
}
afterEach(async () => { await Promise.all(servers.splice(0).map((item) => new Promise<void>((resolve, reject) => item.close((error) => error ? reject(error) : resolve())))); });

describe('reconstruction API', () => {
    it('completes a private phone-to-desktop transfer', async () => {
        const base = await server(); expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ ok: true, contractVersion: 1 });
        const createdResponse = await fetch(`${base}/api/import-sessions`, { method: 'POST' }); const created = await createdResponse.json() as { sessionId: string; editorToken: string; uploadUrl: string };
        expect(createdResponse.status).toBe(201); expect(created.uploadUrl).toMatch(/^https:\/\/example\.test\/upload\//); expect(created.uploadUrl).not.toContain(created.editorToken);
        const token = created.uploadUrl.split('/').at(-1)!; const form = new FormData(); form.append('file', new Blob([png], { type: 'image/png' }), 'phone.png');
        expect((await fetch(`${base}/api/import-sessions/${created.sessionId}`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
        expect((await fetch(`${base}/api/import-sessions/upload/${token}`, { method: 'POST', body: form })).status).toBe(201);
        const status = await fetch(`${base}/api/import-sessions/${created.sessionId}`, { headers: { Authorization: `Bearer ${created.editorToken}` } }); expect(await status.json()).toMatchObject({ status: 'uploaded', mimeType: 'image/png' });
        const image = await fetch(`${base}/api/import-sessions/${created.sessionId}/image`, { headers: { Authorization: `Bearer ${created.editorToken}` } }); expect(image.status).toBe(200); expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
        expect((await fetch(`${base}/api/import-sessions/upload/${token}`, { method: 'POST', body: form })).status).toBe(404);
    });

    it('reconstructs observations and rejects unsupported content', async () => {
        const base = await server(); const observations = { version: 1, widthPx: 100, heightPx: 100, wallSegments: [{ id: 'w', start: [5, 5], end: [95, 5], confidence: 0.9 }], colorComponents: [] };
        const form = new FormData(); form.append('file', new Blob([png], { type: 'image/png' }), 'plan.png'); form.append('mode', 'floorplan'); form.append('observations', JSON.stringify(observations));
        const response = await fetch(`${base}/api/reconstruct`, { method: 'POST', body: form }); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ contractVersion: 1, modeUsed: 'floorplan', requiresScaleConfirmation: true });
        const invalid = new FormData(); invalid.append('file', new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'bad.svg');
        const rejected = await fetch(`${base}/api/reconstruct`, { method: 'POST', body: invalid }); expect(rejected.status).toBe(415); expect(await rejected.json()).toMatchObject({ error: { code: 'IMAGE_UNSUPPORTED' } });
    });

    it('uses validated semantic labels without delegating geometry to AI', async () => {
        const vision: SketchVisionProvider = { analyzeSketch: async () => ({ mode: 'floorplan', legendEntries: [{ label: 'Custom rack', colorHex: '#2255CC', defaultHeightM: 1.8 }], metersPerPixel: 0.05, notes: [] }) };
        const base = await server(vision); const observations = { version: 1, widthPx: 100, heightPx: 100, wallSegments: [], colorComponents: [{ id: 'measured', bounds: { x: 10, y: 20, width: 30, height: 15 }, colorHex: '#2454CA', pixelCount: 400, confidence: 0.9 }] };
        const form = new FormData(); form.append('file', new Blob([png], { type: 'image/png' }), 'legend.png'); form.append('mode', 'auto'); form.append('observations', JSON.stringify(observations));
        const response = await fetch(`${base}/api/reconstruct`, { method: 'POST', body: form }); const body = await response.json() as { scene: { definitions: Record<string, { name: string }>; objects: Array<{ kind: string; dimensionsOverride?: number[] }> } };
        expect(response.status).toBe(200); expect(Object.values(body.scene.definitions).map((value) => value.name)).toContain('Custom rack'); expect(body.scene.objects[0]).toMatchObject({ kind: 'box', dimensionsOverride: [1.5, 1.8, 0.75] });
    });

    it('rejects malformed model output as a structured error', async () => {
        const vision: SketchVisionProvider = { analyzeSketch: async () => ({ mode: 'floorplan', legendEntries: [{ label: '', colorHex: 'blue' }] }) };
        const base = await server(vision); const form = new FormData(); form.append('file', new Blob([png], { type: 'image/png' }), 'legend.png'); form.append('observations', JSON.stringify({ version: 1, widthPx: 10, heightPx: 10, wallSegments: [], colorComponents: [] }));
        const response = await fetch(`${base}/api/reconstruct`, { method: 'POST', body: form }); expect(response.status).toBe(502); expect(await response.json()).toMatchObject({ error: { code: 'AI_RESPONSE_INVALID', retryable: true } });
    });
});
