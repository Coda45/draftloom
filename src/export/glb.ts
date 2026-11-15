// GLB export from a clean, derived Three.js scene: one named node per scene
// object, no helpers, selection outlines, or sketch overlays. glTF is Y-up,
// right-handed, meters, matching Draftloom's world, so no axis conversion is
// needed here; Blender's importer converts to its Z-up frame on import.
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { SceneDocument } from '../scene/schema';
import { buildObject, disposeObject } from '../editor/viewport3d/sceneObjects';

export interface GlbExportOptions {
    includeRegions?: boolean;
}

/** Builds the export scene. Node names are unique; userData (exported as glTF extras) keeps Draftloom IDs. */
export function buildExportScene(scene: SceneDocument, options: GlbExportOptions = {}): THREE.Scene {
    const root = new THREE.Scene();
    root.name = scene.name || 'Draftloom scene';
    const used = new Map<string, number>();
    for (const o of scene.objects) {
        if (o.kind === 'region' && options.includeRegions === false) continue;
        const obj = buildObject(o, scene.definitions, { showUncertainty: false });
        if (!obj) continue;
        const base = obj.name;
        const n = (used.get(base) ?? 0) + 1;
        used.set(base, n);
        obj.name = n === 1 ? base : `${base} ${n}`;
        root.add(obj);
    }
    return root;
}

export async function sceneToGlb(scene: SceneDocument, options: GlbExportOptions = {}): Promise<ArrayBuffer> {
    const root = buildExportScene(scene, options);
    try {
        const exporter = new GLTFExporter();
        const result = await exporter.parseAsync(root, { binary: true, onlyVisible: true, trs: true });
        if (!(result instanceof ArrayBuffer)) throw new Error('GLTFExporter did not return binary data');
        return result;
    } finally {
        disposeObject(root);
    }
}
