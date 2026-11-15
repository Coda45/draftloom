import { describe, expect, it } from 'vitest';
import { SceneCommandError } from '../src/scene/commands';
import { boxDimensions } from '../src/scene/geometry';
import type { BoxInstance } from '../src/scene/schema';
import { SceneStore } from '../src/scene/store';
import { sampleScene } from './helpers';

function box(store: SceneStore, id: string): BoxInstance {
    return store.getScene().objects.find((o) => o.id === id) as BoxInstance;
}

describe('SceneStore', () => {
    it('editDefinition updates linked instances but keeps overrides', () => {
        const store = new SceneStore(sampleScene());
        store.dispatch({ type: 'editDefinition', id: 'def-desk', patch: { dimensions: [2, 0.8, 1] } });
        const defs = store.getScene().definitions;
        expect(boxDimensions(box(store, 'box-desk-1'), defs)).toEqual([2, 0.8, 1]);
        expect(boxDimensions(box(store, 'box-desk-2'), defs)).toEqual([1.6, 1.1, 0.8]);
    });

    it('instance override keeps the bottom-center anchor and can be cleared', () => {
        const store = new SceneStore(sampleScene());
        store.dispatch({ type: 'setInstanceDimensionsOverride', id: 'box-desk-1', dimensions: [1.4, 2.0, 0.7] });
        expect(box(store, 'box-desk-1').position).toEqual([1.5, 0, 1.0]);
        expect(boxDimensions(box(store, 'box-desk-1'), store.getScene().definitions)[1]).toBe(2.0);
        store.dispatch({ type: 'clearInstanceDimensionsOverride', id: 'box-desk-1' });
        expect(box(store, 'box-desk-1').dimensionsOverride).toBeUndefined();
    });

    it('stores explicit per-instance names in the canonical object', () => {
        const store = new SceneStore(sampleScene());
        store.dispatch({ type: 'renameObject', id: 'box-desk-1', name: 'Conference desk' });
        expect(box(store, 'box-desk-1').name).toBe('Conference desk');
        store.dispatch({ type: 'renameObject', id: 'box-desk-1', name: '' });
        expect(box(store, 'box-desk-1').name).toBeUndefined();
    });

    it('undo and redo restore committed edits without mutating history', () => {
        const store = new SceneStore(sampleScene());
        const before = store.getScene();
        store.dispatch({ type: 'moveBox', id: 'box-desk-1', position: [2, 0, 2] });
        expect(before.objects.find((o) => o.id === 'box-desk-1')).toMatchObject({ position: [1.5, 0, 1.0] });
        store.undo();
        expect(store.getScene()).toBe(before);
        store.redo();
        expect(box(store, 'box-desk-1').position).toEqual([2, 0, 2]);
        expect(store.getState().canUndo).toBe(true);
    });

    it('notifies subscribers and bumps revision only on scene changes', () => {
        const store = new SceneStore(sampleScene());
        const kinds: string[] = [];
        store.subscribe((k) => kinds.push(k));
        store.setSelectedId('wall-north');
        store.dispatch({ type: 'setWallHeight', id: 'wall-north', height: 3 });
        expect(kinds).toEqual(['selection', 'scene']);
        expect(store.getState().revision).toBe(1);
        expect(store.getState().selectedId).toBe('wall-north');
    });

    it('rejects invalid edits without changing the scene', () => {
        const store = new SceneStore(sampleScene());
        const before = store.getScene();
        expect(() => store.dispatch({ type: 'moveRegionVertex', id: 'region-storage', index: 0, point: [7.6, 5.6] })).toThrow(SceneCommandError);
        expect(() => store.dispatch({ type: 'setWallHeight', id: 'wall-north', height: 0 })).toThrow(SceneCommandError);
        expect(() => store.dispatch({ type: 'addBox', box: { kind: 'box', id: 'box-desk-1', definitionId: 'def-desk', position: [0, 0, 0], rotationY: 0 } })).toThrow(/already exists/);
        expect(store.getScene()).toBe(before);
    });

    it('deleting the selected object clears selection; replaceScene clears history', () => {
        const store = new SceneStore(sampleScene());
        store.setSelectedId('box-rack-1');
        store.dispatch({ type: 'deleteObject', id: 'box-rack-1' });
        expect(store.getState().selectedId).toBeNull();
        store.replaceScene(sampleScene());
        expect(store.getState().canUndo).toBe(false);
    });
});
