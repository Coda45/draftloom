// IndexedDB persistence for the last project and its source-image Blobs,
// plus a debounced autosave controller. Uses indexedDB directly.
import type { SceneDocument } from './schema';
import type { SceneStore } from './store';
import { validateScene } from './validate';

const DB_NAME = 'draftloom';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const BLOBS = 'blobs';
const LAST_KEY = 'last';

export interface SavedProject {
    scene: SceneDocument;
    savedAt: string;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
    });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted (storage may be full)'));
    });
}

export class ProjectStorage {
    private dbPromise: Promise<IDBDatabase> | null = null;

    constructor(private readonly factory: IDBFactory = indexedDB, private readonly dbName = DB_NAME) {}

    private db(): Promise<IDBDatabase> {
        if (!this.dbPromise) {
            this.dbPromise = new Promise((resolve, reject) => {
                const req = this.factory.open(this.dbName, DB_VERSION);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS);
                    if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error ?? new Error('Could not open IndexedDB'));
                req.onblocked = () => reject(new Error('IndexedDB is blocked by another open tab'));
            });
            this.dbPromise.catch(() => {
                this.dbPromise = null;
            });
        }
        return this.dbPromise;
    }

    async saveProject(scene: SceneDocument): Promise<SavedProject> {
        const db = await this.db();
        const tx = db.transaction(PROJECTS, 'readwrite');
        const record: SavedProject = { scene, savedAt: new Date().toISOString() };
        tx.objectStore(PROJECTS).put(record, LAST_KEY);
        await transactionDone(tx);
        return record;
    }

    /** Returns the last saved project, or null if none or it fails validation. */
    async loadProject(): Promise<SavedProject | null> {
        const db = await this.db();
        const tx = db.transaction(PROJECTS, 'readonly');
        const record = (await request(tx.objectStore(PROJECTS).get(LAST_KEY))) as SavedProject | undefined;
        if (!record) return null;
        const v = validateScene(record.scene);
        if (!v.ok) {
            console.warn('Ignoring invalid autosaved project', v.errors);
            return null;
        }
        return { scene: v.scene, savedAt: record.savedAt };
    }

    async clearProject(): Promise<void> {
        const db = await this.db();
        const tx = db.transaction(PROJECTS, 'readwrite');
        tx.objectStore(PROJECTS).delete(LAST_KEY);
        await transactionDone(tx);
    }

    async putBlob(key: string, blob: Blob): Promise<void> {
        const db = await this.db();
        const tx = db.transaction(BLOBS, 'readwrite');
        tx.objectStore(BLOBS).put(blob, key);
        await transactionDone(tx);
    }

    async getBlob(key: string): Promise<Blob | null> {
        const db = await this.db();
        const tx = db.transaction(BLOBS, 'readonly');
        const blob = (await request(tx.objectStore(BLOBS).get(key))) as Blob | undefined;
        return blob ?? null;
    }
}

export type SaveStatus = { state: 'idle' } | { state: 'pending' } | { state: 'saving' } | { state: 'saved'; at: string } | { state: 'error'; message: string };

export interface AutosaveOptions {
    debounceMs?: number;
    flushIntervalMs?: number;
}

/** Saves the store's scene after committed edits (debounced) and periodically while dirty. */
export class Autosave {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private interval: ReturnType<typeof setInterval> | null = null;
    private dirty = false;
    private saving: Promise<void> | null = null;
    private unsubscribe: (() => void) | null = null;
    private status: SaveStatus = { state: 'idle' };
    private statusListeners = new Set<(s: SaveStatus) => void>();
    private readonly debounceMs: number;
    private readonly flushIntervalMs: number;

    constructor(private readonly store: SceneStore, private readonly storage: ProjectStorage, options: AutosaveOptions = {}) {
        this.debounceMs = options.debounceMs ?? 1500;
        this.flushIntervalMs = options.flushIntervalMs ?? 20000;
    }

    start(): void {
        if (this.unsubscribe) return;
        this.unsubscribe = this.store.subscribe((kind) => {
            if (kind !== 'scene') return;
            this.dirty = true;
            this.setStatus({ state: 'pending' });
            if (this.timer) clearTimeout(this.timer);
            this.timer = setTimeout(() => void this.flush(), this.debounceMs);
        });
        this.interval = setInterval(() => {
            if (this.dirty) void this.flush();
        }, this.flushIntervalMs);
    }

    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
        if (this.timer) clearTimeout(this.timer);
        if (this.interval) clearInterval(this.interval);
        this.timer = null;
        this.interval = null;
    }

    getStatus(): SaveStatus {
        return this.status;
    }

    onStatus(fn: (s: SaveStatus) => void): () => void {
        this.statusListeners.add(fn);
        return () => this.statusListeners.delete(fn);
    }

    /** Writes immediately if there are unsaved changes. */
    async flush(): Promise<void> {
        if (this.saving) await this.saving;
        if (!this.dirty) return;
        this.dirty = false;
        const scene = this.store.getScene();
        this.setStatus({ state: 'saving' });
        this.saving = this.storage
            .saveProject(scene)
            .then((r) => {
                if (!this.dirty) this.setStatus({ state: 'saved', at: r.savedAt });
            })
            .catch((err: unknown) => {
                this.dirty = true;
                const message = err instanceof Error ? err.message : String(err);
                this.setStatus({ state: 'error', message: `Autosave failed: ${message}` });
            })
            .finally(() => {
                this.saving = null;
            });
        await this.saving;
    }

    private setStatus(s: SaveStatus): void {
        this.status = s;
        for (const l of this.statusListeners) l(s);
    }
}
