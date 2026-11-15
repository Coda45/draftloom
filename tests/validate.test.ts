import { describe, expect, it } from 'vitest';
import { validateScene } from '../src/scene/validate';
import { sampleScene } from './helpers';

describe('validateScene', () => {
    it('accepts the sample studio', () => {
        const r = validateScene(sampleScene());
        expect(r.ok).toBe(true);
    });

    it('migrates the editor pre-contract scene shape without losing geometry', () => {
        const legacy = {
            schemaVersion: 1,
            id: 'legacy-scene',
            name: 'Legacy scene',
            units: 'meters',
            createdAt: '2026-11-14T00:00:00.000Z',
            updatedAt: '2026-11-14T00:00:00.000Z',
            settings: { gridSizeM: 0.25, gridSnap: true, snapAngle: 'free', snapToleranceDeg: 8 },
            definitions: [{ id: 'legacy-def', name: 'Table', color: '#112233', defaultDimensions: [2, 1, 1] }],
            objects: [
                { kind: 'box', id: 'legacy-box', name: 'Reception table', definitionId: 'legacy-def', position: [1, 0, 2], yaw: Math.PI / 2, provenance: { origin: 'manual' } },
                { kind: 'wall', id: 'legacy-wall', start: [0, 0], end: [4, 0], heightM: 3, thicknessM: 0.2, provenance: { origin: 'reconstructed', confidence: 0.8 } },
            ],
            source: {
                kind: 'top-down',
                fileName: 'legacy.png',
                imageKey: 'legacy-image',
                calibration: { method: 'manual', pixelToWorld: [2, 3, 4, 5, 6, 7] },
            },
        };
        const r = validateScene(legacy);
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.scene.units).toBe('m');
            expect(r.scene.upAxis).toBe('Y');
            expect(r.scene.definitions['legacy-def'].dimensions).toEqual([2, 1, 1]);
            expect(r.scene.objects[0]).toMatchObject({ name: 'Reception table', rotationY: Math.PI / 2, provenance: { method: 'manual' } });
            expect(r.scene.objects[1]).toMatchObject({ baseY: 0, height: 3, thickness: 0.2, provenance: { method: 'detected' } });
            expect(r.scene.sources[0].pixelToWorldXZ).toEqual([2, 5, 3, 6, 4, 7]);
            expect(r.scene.settings.snapAngleDeg).toBe(0);
            expect(r.scene.settings.gridSnap).toBe(true);
        }
    });

    it('rejects unsupported schema versions', () => {
        const s = { ...sampleScene(), schemaVersion: 2 };
        const r = validateScene(s);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.errors[0]).toMatch(/unsupported version 2/);
    });

    it('rejects NaN, Infinity, and nonpositive dimensions', () => {
        const s = sampleScene() as any;
        s.definitions['def-desk'].dimensions = [1, 0, 1];
        s.objects[4].position = [NaN, 0, 0];
        s.objects[0].height = Infinity;
        const r = validateScene(s);
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.errors.join('\n')).toMatch(/dimensions\[1\]: must be greater than zero/);
            expect(r.errors.join('\n')).toMatch(/position\[0\]: must be a finite number/);
            expect(r.errors.join('\n')).toMatch(/height: must be a finite number/);
        }
    });

    it('rejects missing definitions, duplicate IDs and malformed colors', () => {
        const s = sampleScene() as any;
        s.objects[4].definitionId = 'def-missing';
        s.objects[5].id = s.objects[4].id;
        s.definitions['def-rack'].color = 'orange';
        const r = validateScene(s);
        expect(r.ok).toBe(false);
        if (!r.ok) {
            const text = r.errors.join('\n');
            expect(text).toMatch(/missing definition "def-missing"/);
            expect(text).toMatch(/duplicate id "box-desk-1"/);
            expect(text).toMatch(/#RRGGBB color/);
        }
    });

    it('rejects self-intersecting and zero-area polygons', () => {
        const bowtie = sampleScene() as any;
        bowtie.objects[7].polygon = [[0, 0], [2, 2], [2, 0], [0, 2]];
        expect(validateScene(bowtie).ok).toBe(false);
        const flat = sampleScene() as any;
        flat.objects[7].polygon = [[0, 0], [1, 0], [2, 0]];
        expect(validateScene(flat).ok).toBe(false);
    });

    it('rejects suspiciously large object counts and unknown kinds', () => {
        const big = sampleScene() as any;
        big.objects = Array.from({ length: 5001 }, (_, i) => ({ ...big.objects[0], id: `w${i}` }));
        const r = validateScene(big);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.errors[0]).toMatch(/suspiciously large/);
        const odd = sampleScene() as any;
        odd.objects[0].kind = 'sphere';
        expect(validateScene(odd).ok).toBe(false);
    });

    it('validates portable grid-snap and source image metadata', () => {
        const scene = sampleScene();
        scene.settings.gridSnap = true;
        scene.sources = [{
            id: 'source-1',
            name: 'plan.png',
            mode: 'floorplan',
            mimeType: 'image/png',
            widthPx: 1200,
            heightPx: 900,
            pixelToWorldXZ: [0.01, 0, 0, 0.01, 0, 0],
            calibrationMethod: 'manual',
        }];
        expect(validateScene(scene).ok).toBe(true);
        (scene.sources[0] as { widthPx: number }).widthPx = 0;
        expect(validateScene(scene).ok).toBe(false);
    });
});
