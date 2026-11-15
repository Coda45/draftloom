import { describe, expect, it } from 'vitest';
import { SceneCommandError, applyCommand } from '../src/scene/commands';
import type { BoxInstance, SceneDocument, WallSegment } from '../src/scene/schema';
import { validateScene } from '../src/scene/validate';
import { sampleScene } from './helpers';

const wall = (s: SceneDocument) => s.objects.find((o) => o.id === 'wall-north') as WallSegment;
const desk = (s: SceneDocument) => s.objects.find((o) => o.id === 'box-desk-2') as BoxInstance;

function withSource(): SceneDocument {
    const scene = sampleScene();
    scene.sources = [{ id: 'src', name: 'sketch', mode: 'floorplan', pixelToWorldXZ: [0.01, 0, 0, 0.01, 0.5, 0.25], calibrationMethod: 'inferred' }];
    return scene;
}

describe('scaleScene', () => {
    it('rescales plan measurements and the overlay calibration, keeping heights by default', () => {
        const scene = withSource();
        const next = applyCommand(scene, { type: 'scaleScene', factor: 2, calibration: 'manual' });

        expect(wall(next).start).toEqual(wall(scene).start.map((n) => n * 2));
        expect(wall(next).end).toEqual(wall(scene).end.map((n) => n * 2));
        expect(wall(next).thickness).toBe(wall(scene).thickness * 2);
        expect([wall(next).baseY, wall(next).height]).toEqual([wall(scene).baseY, wall(scene).height]);

        const [w, h, d] = desk(scene).dimensionsOverride!;
        expect(desk(next).dimensionsOverride).toEqual([w * 2, h, d * 2]);
        const [px, py, pz] = desk(scene).position;
        expect(desk(next).position).toEqual([px * 2, py, pz * 2]);
        const [dw, dh, dd] = scene.definitions['def-desk'].dimensions;
        expect(next.definitions['def-desk'].dimensions).toEqual([dw * 2, dh, dd * 2]);

        // The overlay stays aligned: pixel -> world is scaled by the same factor.
        expect(next.sources[0].pixelToWorldXZ).toEqual([0.02, 0, 0, 0.02, 1, 0.5]);
        expect(next.sources[0].calibrationMethod).toBe('manual');
        expect(validateScene(next).ok).toBe(true);
    });

    it('scales heights too when they come from the same image scale', () => {
        const scene = withSource();
        const next = applyCommand(scene, { type: 'scaleScene', factor: 2, includeHeights: true });
        expect(wall(next).height).toBe(wall(scene).height * 2);
        expect(desk(next).dimensionsOverride![1]).toBe(desk(scene).dimensionsOverride![1] * 2);
        expect(next.sources[0].calibrationMethod).toBe('inferred');
    });

    it('rejects non-positive factors', () => {
        expect(() => applyCommand(sampleScene(), { type: 'scaleScene', factor: 0 })).toThrow(SceneCommandError);
        expect(() => applyCommand(sampleScene(), { type: 'scaleScene', factor: Number.NaN })).toThrow(SceneCommandError);
    });
});
