import './fileReaderPolyfill';
import { describe, expect, it } from 'vitest';
import { sceneToGlb } from '../src/export/glb';
import { parseProjectFile, serializeScene } from '../src/export/nativeJson';
import { sceneToSvg } from '../src/export/svg';
import { sampleScene } from './helpers';

interface GltfJson {
    nodes: { name: string; mesh?: number; translation?: number[]; rotation?: number[]; extras?: Record<string, unknown> }[];
    meshes: { primitives: { attributes: { POSITION: number } }[] }[];
    accessors: { min?: number[]; max?: number[] }[];
}

/** Reads the JSON chunk of a GLB container. */
function readGlbJson(buf: ArrayBuffer): GltfJson {
    const view = new DataView(buf);
    expect(view.getUint32(0, true)).toBe(0x46546c67); // "glTF"
    expect(view.getUint32(4, true)).toBe(2);
    const chunkLength = view.getUint32(12, true);
    expect(view.getUint32(16, true)).toBe(0x4e4f534a); // "JSON"
    return JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, chunkLength)));
}

describe('native JSON', () => {
    it('round-trips losslessly, including IDs, overrides, settings, and provenance', () => {
        const scene = sampleScene();
        const parsed = parseProjectFile(serializeScene(scene));
        expect(parsed.ok).toBe(true);
        if (parsed.ok && parsed.kind === 'scene') expect(parsed.scene).toEqual(scene);
    });

    it('accepts a ReconstructionResult file and reports bad JSON', () => {
        const parsed = parseProjectFile(JSON.stringify({ contractVersion: 1, scene: sampleScene(), issues: [{ id: 'i1', severity: 'warning', code: 'x', message: 'Check wall' }] }));
        expect(parsed.ok && parsed.kind === 'reconstruction' && parsed.result.issues).toHaveLength(1);
        const bad = parseProjectFile('{not json');
        expect(bad.ok).toBe(false);
    });
});

describe('SVG export', () => {
    it('produces meter-based geometry without editor handles', () => {
        const svg = sceneToSvg(sampleScene());
        expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
        // Sample walls span 0..8 x 0..6 with 0.15 m thickness, plus 0.5 m margin.
        expect(svg).toMatch(/viewBox="-0\.575 -0\.575 9\.15 7\.15"/);
        expect(svg).toContain('id="box-desk-1"');
        expect(svg).toContain('id="region-storage"');
        expect(svg).toContain('Standing desk');
        expect(svg).not.toMatch(/handle/i);
        // Desk 1 at (1.5, 1.0), 1.4 x 0.7: corners at x 0.8..2.2, z 0.65..1.35.
        expect(svg).toContain('points="0.8,0.65 2.2,0.65 2.2,1.35 0.8,1.35"');
    });
});

describe('GLB export', () => {
    it('exports separate named nodes with correct transforms and dimensions', async () => {
        const glb = await sceneToGlb(sampleScene());
        const json = readGlbJson(glb);
        const names = json.nodes.map((n) => n.name);
        expect(names).toEqual(['North wall', 'East wall', 'South wall', 'West wall', 'Desk', 'Standing desk', 'Storage Rack', 'Storage zone']);

        const desk = json.nodes.find((n) => n.name === 'Standing desk')!;
        expect(desk.translation).toEqual([3.5, 0, 1]);
        expect(desk.extras).toMatchObject({ draftloomId: 'box-desk-2', kind: 'box', definitionId: 'def-desk' });
        const pos = json.accessors[json.meshes[desk.mesh!].primitives[0].attributes.POSITION];
        // Override 1.6 x 1.1 x 0.8, bottom-centered: y from 0 to 1.1.
        expect(pos.min![0]).toBeCloseTo(-0.8);
        expect(pos.max![0]).toBeCloseTo(0.8);
        expect(pos.min![1]).toBeCloseTo(0);
        expect(pos.max![1]).toBeCloseTo(1.1);
        expect(pos.max![2]).toBeCloseTo(0.4);

        const rack = json.nodes.find((n) => n.name === 'Storage Rack')!;
        // 90° yaw about +Y as a quaternion [x, y, z, w].
        expect(rack.rotation![1]).toBeCloseTo(Math.SQRT1_2);
        expect(rack.rotation![3]).toBeCloseTo(Math.SQRT1_2);
    });

    it('makes duplicate names unique', async () => {
        const scene = sampleScene();
        scene.objects = scene.objects.filter((o) => o.kind === 'box').map((o) => ({ ...o, name: undefined }));
        const json = readGlbJson(await sceneToGlb(scene));
        expect(json.nodes.map((n) => n.name)).toEqual(['Desk', 'Desk 2', 'Storage Rack']);
    });
});
