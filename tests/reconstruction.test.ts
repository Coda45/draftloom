import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import example from '../samples/example-reconstruction-result.json';
import { applyReconstruction } from '../src/app/reconstructionIntegration';
import { ProjectStorage } from '../src/scene/persistence';
import { SceneStore } from '../src/scene/store';
import type { ReconstructionResult } from '../src/shared/reconstruction-contract';
import { sampleScene } from './helpers';

const result = () => structuredClone(example) as ReconstructionResult;

describe('applyReconstruction', () => {
    it('validates, replaces the document unchanged, and returns issues', async () => {
        const store = new SceneStore(sampleScene());
        store.dispatch({ type: 'deleteObject', id: 'wall-north' });
        const r = await applyReconstruction(store, null, result());
        expect(r.ok && r.issues).toHaveLength(2);
        expect(store.getScene()).toEqual(result().scene);
        expect(store.getState().canUndo).toBe(false);
    });

    it('rejects an invalid scene without touching the current document', async () => {
        const store = new SceneStore(sampleScene());
        const before = store.getScene();
        const bad = result();
        (bad.scene.objects[4] as { definitionId: string }).definitionId = 'nope';
        const r = await applyReconstruction(store, null, bad);
        expect(r.ok).toBe(false);
        expect(store.getScene()).toBe(before);
    });

    it('stores the source image under scene.source.imageKey', async () => {
        const storage = new ProjectStorage(new IDBFactory());
        const store = new SceneStore(sampleScene());
        const r = await applyReconstruction(store, storage, result(), new Blob(['png-bytes'], { type: 'image/png' }));
        expect(r.ok).toBe(true);
        const key = store.getScene().source?.imageKey;
        expect(key).toMatch(/^img-/);
        expect(store.getScene().source?.calibration?.method).toBe('reconstructed');
        expect(await storage.getBlob(key!)).not.toBeNull();
    });
});
