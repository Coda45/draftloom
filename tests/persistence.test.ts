import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { Autosave, ProjectStorage, type SaveStatus } from '../src/scene/persistence';
import { SceneStore } from '../src/scene/store';
import { sampleScene } from './helpers';

describe('ProjectStorage', () => {
    it('saves and restores the last project and image blobs', async () => {
        const storage = new ProjectStorage(new IDBFactory());
        expect(await storage.loadProject()).toBeNull();
        const scene = sampleScene();
        await storage.saveProject(scene);
        const loaded = await storage.loadProject();
        expect(loaded?.scene).toEqual(scene);

        await storage.putBlob('img-1', new Blob(['hello'], { type: 'text/plain' }));
        const blob = await storage.getBlob('img-1');
        expect(blob).not.toBeNull();
        expect(await storage.getBlob('missing')).toBeNull();
    });

    it('ignores a stored project that fails validation', async () => {
        const storage = new ProjectStorage(new IDBFactory());
        const bad = { ...sampleScene(), schemaVersion: 99 } as never;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await storage.saveProject(bad);
        expect(await storage.loadProject()).toBeNull();
        warn.mockRestore();
    });
});

describe('Autosave', () => {
    it('debounces committed edits into one save and reports status', async () => {
        vi.useFakeTimers();
        const storage = new ProjectStorage(new IDBFactory());
        const save = vi.spyOn(storage, 'saveProject');
        const store = new SceneStore(sampleScene());
        const autosave = new Autosave(store, storage, { debounceMs: 1000, flushIntervalMs: 20000 });
        const statuses: SaveStatus['state'][] = [];
        autosave.onStatus((s) => statuses.push(s.state));
        autosave.start();

        store.dispatch({ type: 'moveBox', id: 'box-desk-1', position: [2, 0, 2] });
        store.dispatch({ type: 'moveBox', id: 'box-desk-1', position: [3, 0, 2] });
        store.setSelectedId('box-desk-1'); // selection alone must not trigger a save
        expect(save).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1100);
        vi.useRealTimers();
        await autosave.flush();
        expect(save).toHaveBeenCalledTimes(1);
        expect(statuses.at(-1)).toBe('saved');
        const loaded = await storage.loadProject();
        expect(loaded?.scene.objects.find((o) => o.id === 'box-desk-1')).toMatchObject({ position: [3, 0, 2] });
        autosave.stop();
    });

    it('surfaces write failures as an error status', async () => {
        const storage = new ProjectStorage(new IDBFactory());
        vi.spyOn(storage, 'saveProject').mockRejectedValue(new Error('QuotaExceededError'));
        const store = new SceneStore(sampleScene());
        const autosave = new Autosave(store, storage, { debounceMs: 10 });
        autosave.start();
        store.dispatch({ type: 'setWallHeight', id: 'wall-north', height: 3 });
        await autosave.flush();
        expect(autosave.getStatus()).toEqual({ state: 'error', message: 'Autosave failed: QuotaExceededError' });
        autosave.stop();
    });
});
