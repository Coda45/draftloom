import { describe, expect, it } from 'vitest';
import { reconstructFloorplan } from '../server/reconstruction/floorplan/reconstruct';
import { validateSketchSemantics } from '../server/ai/validate-semantics';
import { validateScene } from '../src/scene/validate';

const image = { bytes: Buffer.from('unused'), mimeType: 'image/png' as const, widthPx: 200, heightPx: 100, name: 'warehouse.png' };
const observations = { version: 1 as const, widthPx: 200, heightPx: 100, wallSegments: [{ id: 'w1', start: [10, 10] as [number, number], end: [190, 10] as [number, number], confidence: 0.9 }], colorComponents: [{ id: 'c1', bounds: { x: 30, y: 30, width: 20, height: 10 }, colorHex: '#2050D0', pixelCount: 180, confidence: 0.88 }] };

describe('floor-plan reconstruction', () => {
    it('creates validated Y-up editable walls and box instances', () => {
        const semantics = validateSketchSemantics({ mode: 'floorplan', legendEntries: [{ label: 'Rack', colorHex: '#204FD2', defaultHeightM: 2 }], metersPerPixel: 0.05, notes: [] });
        const result = reconstructFloorplan({ image, observations, semantics });
        expect(result.contractVersion).toBe(1);
        expect(result.requiresScaleConfirmation).toBe(false);
        expect(result.scene.objects.map((object) => object.kind)).toEqual(['wall', 'box']);
        expect(result.scene.units).toBe('m'); expect(result.scene.upAxis).toBe('Y');
        expect(validateScene(result.scene).ok).toBe(true);
    });

    it('preserves useful geometry with warnings when AI and scale are unavailable', () => {
        const result = reconstructFloorplan({ image, observations });
        expect(result.requiresScaleConfirmation).toBe(true);
        expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['SCALE_CONFIRMATION_REQUIRED', 'AI_SEMANTICS_UNAVAILABLE']));
        expect(result.scene.objects.length).toBe(2);
    });

    it('rejects malformed AI responses', () => {
        expect(() => validateSketchSemantics({ mode: 'floorplan', legendEntries: [{ label: '', colorHex: 'blue' }] })).toThrow(/invalid legend entry/i);
    });
});
