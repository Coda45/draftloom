// Small observable scene store with bounded undo/redo. Views subscribe to it
// and dispatch commands; they never own scene data themselves.
import { applyCommand, isHistoryBoundary, type SceneCommand } from './commands';
import type { SceneDocument } from './schema';

export interface SceneStoreState {
    scene: SceneDocument;
    /** What views should draw: a transient drag preview if one is active, else `scene`. */
    displayScene: SceneDocument;
    /** UI-only selection; never saved with the scene. */
    selectedId: string | null;
    canUndo: boolean;
    canRedo: boolean;
    /** Increments on every committed scene change (not on selection changes). */
    revision: number;
}

export type ChangeKind = 'scene' | 'selection' | 'preview';
type Listener = (kind: ChangeKind) => void;

const HISTORY_LIMIT = 100;

export class SceneStore {
    private scene: SceneDocument;
    private selectedId: string | null = null;
    private preview: SceneDocument | null = null;
    private past: SceneDocument[] = [];
    private future: SceneDocument[] = [];
    private revision = 0;
    private listeners = new Set<Listener>();
    private snapshot: SceneStoreState;

    constructor(initial: SceneDocument) {
        this.scene = initial;
        this.snapshot = this.buildSnapshot();
    }

    getScene(): SceneDocument {
        return this.scene;
    }

    /** Stable snapshot for useSyncExternalStore; replaced only on change. */
    getState = (): SceneStoreState => this.snapshot;

    subscribe = (listener: Listener): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    /** Applies one undoable command. Throws SceneCommandError on invalid edits. */
    dispatch(cmd: SceneCommand): void {
        let next: SceneDocument;
        try {
            next = applyCommand(this.scene, cmd);
        } catch (err) {
            this.setPreview(null);
            throw err;
        }
        if (next === this.scene) {
            this.setPreview(null);
            return;
        }
        this.preview = null;
        if (isHistoryBoundary(cmd)) {
            this.past = [];
            this.future = [];
        } else {
            this.past.push(this.scene);
            if (this.past.length > HISTORY_LIMIT) this.past.shift();
            this.future = [];
        }
        this.scene = next;
        if (this.selectedId && !this.scene.objects.some((o) => o.id === this.selectedId)) this.selectedId = null;
        this.commit('scene');
    }

    /** Replaces the whole document (import, restore). Clears undo history. */
    replaceScene(scene: SceneDocument): void {
        this.dispatch({ type: 'loadScene', scene });
        this.selectedId = null;
        this.commit('selection');
    }

    /**
     * Shows a transient, uncommitted scene (e.g. during a drag) in every view.
     * Not recorded in history and not autosaved. Pass null to clear.
     */
    setPreview(scene: SceneDocument | null): void {
        if (scene === this.preview) return;
        this.preview = scene;
        this.commit('preview');
    }

    /** Previews a command's result without committing. Returns false if the command is invalid. */
    previewCommand(cmd: SceneCommand): boolean {
        try {
            this.setPreview(applyCommand(this.scene, cmd));
            return true;
        } catch {
            return false;
        }
    }

    undo(): void {
        const prev = this.past.pop();
        if (!prev) return;
        this.preview = null;
        this.future.push(this.scene);
        this.scene = prev;
        this.pruneSelection();
        this.commit('scene');
    }

    redo(): void {
        const next = this.future.pop();
        if (!next) return;
        this.preview = null;
        this.past.push(this.scene);
        this.scene = next;
        this.pruneSelection();
        this.commit('scene');
    }

    setSelectedId(id: string | null): void {
        if (id === this.selectedId) return;
        this.selectedId = id;
        this.commit('selection');
    }

    private pruneSelection(): void {
        if (this.selectedId && !this.scene.objects.some((o) => o.id === this.selectedId)) this.selectedId = null;
    }

    private buildSnapshot(): SceneStoreState {
        return {
            scene: this.scene,
            displayScene: this.preview ?? this.scene,
            selectedId: this.selectedId,
            canUndo: this.past.length > 0,
            canRedo: this.future.length > 0,
            revision: this.revision,
        };
    }

    private commit(kind: ChangeKind): void {
        if (kind === 'scene') this.revision++;
        this.snapshot = this.buildSnapshot();
        for (const l of this.listeners) l(kind);
    }
}
