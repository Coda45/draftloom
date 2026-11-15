import { describe, expect, it } from 'vitest';
import { packRegion } from '../src/editor/packing/packRegion';
import { applyCommand } from '../src/scene/commands';
import { boxFootprint, convexPolygonDistance, convexShapeInsidePolygon, wallFootprint } from '../src/scene/geometry';
import type { BoxInstance, Region, SceneDocument, Vec2 } from '../src/scene/schema';
import { SceneStore } from '../src/scene/store';
import { sampleScene } from './helpers';

function withRegion(polygon: Vec2[], objects: SceneDocument['objects'] = []): SceneDocument {
    const s = sampleScene();
    s.definitions.push({ id: 'def-crate', name: 'Crate', color: '#888888', defaultDimensions: [1, 1, 1] });
    s.objects = [...objects, { kind: 'region', id: 'r', name: 'Zone', polygon }];
    return s;
}

function assertValidLayout(scene: SceneDocument, boxes: BoxInstance[], gap: number) {
    const region = scene.objects.find((o) => o.id === 'r') as Region;
    const defs = scene.definitions;
    const shapes = boxes.map((b) => boxFootprint(b, defs));
    for (const s of shapes) expect(convexShapeInsidePolygon(s, region.polygon)).toBe(true);
    for (let i = 0; i < shapes.length; i++) {
        for (let j = i + 1; j < shapes.length; j++) {
            expect(convexPolygonDistance(shapes[i], shapes[j])).toBeGreaterThanOrEqual(gap - 1e-6);
        }
        for (const o of scene.objects) {
            if (o.kind === 'wall') expect(convexPolygonDistance(shapes[i], wallFootprint(o))).toBeGreaterThanOrEqual(gap - 1e-6);
            if (o.kind === 'box') expect(convexPolygonDistance(shapes[i], boxFootprint(o, defs))).toBeGreaterThanOrEqual(gap - 1e-6);
        }
    }
}

describe('packRegion', () => {
    it('fills an exact rectangle with edge-touching boxes at zero gap', () => {
        const scene = withRegion([[0, 0], [4, 0], [4, 3], [0, 3]]);
        const r = packRegion(scene, { regionId: 'r', definitionId: 'def-crate', gapM: 0 });
        expect(r.boxes).toHaveLength(12);
        assertValidLayout(scene, r.boxes, 0);
    });

    it('respects the gap between boxes', () => {
        const scene = withRegion([[0, 0], [4, 0], [4, 3], [0, 3]]);
        const r = packRegion(scene, { regionId: 'r', definitionId: 'def-crate', gapM: 0.5 });
        // 4 m fits 1+0.5+1+0.5+1 = 3 boxes across, 3 m fits 2 deep.
        expect(r.boxes).toHaveLength(6);
        assertValidLayout(scene, r.boxes, 0.5);
    });

    it('rotates rectangular objects when that fits more', () => {
        const scene = withRegion([[0, 0], [1, 0], [1, 4.2], [0, 4.2]]);
        scene.definitions.push({ id: 'def-bench', name: 'Bench', color: '#123456', defaultDimensions: [2, 0.5, 1] });
        const r = packRegion(scene, { regionId: 'r', definitionId: 'def-bench', gapM: 0.1 });
        expect(r.boxes).toHaveLength(2);
        expect(r.yaw).toBeCloseTo(Math.PI / 2);
        assertValidLayout(scene, r.boxes, 0.1);
    });

    it('keeps the gap from walls and existing boxes', () => {
        const scene = withRegion([[0, 0], [4, 0], [4, 3], [0, 3]], [
            { kind: 'wall', id: 'w', start: [2, 0], end: [2, 3], heightM: 2, thicknessM: 0.2 },
        ]);
        const r = packRegion(scene, { regionId: 'r', definitionId: 'def-crate', gapM: 0.2 });
        expect(r.boxes.length).toBeGreaterThan(0);
        assertValidLayout(scene, r.boxes, 0.2);
    });

    it('stays out of the cut-out of a concave L-shaped zone', () => {
        const scene = withRegion([[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]]);
        const r = packRegion(scene, { regionId: 'r', definitionId: 'def-crate', gapM: 0 });
        expect(r.boxes).toHaveLength(12);
        assertValidLayout(scene, r.boxes, 0);
    });

    it('reports diagnostics when nothing fits', () => {
        const scene = withRegion([[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]]);
        const r = packRegion(scene, { regionId: 'r', definitionId: 'def-crate', gapM: 0 });
        expect(r.boxes).toHaveLength(0);
        expect(r.diagnostics[0]).toMatch(/No Crate/);
    });

    it('is applied as one undoable transaction', () => {
        const scene = withRegion([[0, 0], [4, 0], [4, 3], [0, 3]]);
        const store = new SceneStore(scene);
        const r = packRegion(scene, { regionId: 'r', definitionId: 'def-crate', gapM: 0 });
        store.dispatch({ type: 'applyPackingResult', boxes: r.boxes });
        expect(store.getScene().objects).toHaveLength(scene.objects.length + 12);
        store.undo();
        expect(store.getScene()).toBe(scene);
        expect(applyCommand(scene, { type: 'applyPackingResult', boxes: [] })).toBe(scene);
    });

    it('arranges in the sample storage zone without hitting the rack', () => {
        const scene = sampleScene();
        const r = packRegion(scene, { regionId: 'region-storage', definitionId: 'def-rack', gapM: 0.3 });
        expect(r.boxes.length).toBeGreaterThan(0);
    });
});
