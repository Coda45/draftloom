// React bindings for the scene store plus a shared notice channel for errors.
import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { SceneCommandError, type SceneCommand } from '../scene/commands';
import type { SceneStore, SceneStoreState } from '../scene/store';

export interface EditorApi {
    store: SceneStore;
    /** Dispatches a command; invalid edits are reported to the user instead of throwing. Returns success. */
    run(cmd: SceneCommand): boolean;
    notify(message: string, tone?: NoticeTone): void;
}

export type NoticeTone = 'info' | 'error';

const Ctx = createContext<EditorApi | null>(null);

export function EditorProvider({ store, notify, children }: { store: SceneStore; notify: EditorApi['notify']; children: ReactNode }) {
    const run = useCallback(
        (cmd: SceneCommand): boolean => {
            try {
                store.dispatch(cmd);
                return true;
            } catch (err) {
                if (err instanceof SceneCommandError) {
                    notify(err.message, 'error');
                    return false;
                }
                throw err;
            }
        },
        [store, notify],
    );
    return <Ctx.Provider value={{ store, run, notify }}>{children}</Ctx.Provider>;
}

export function useEditor(): EditorApi {
    const api = useContext(Ctx);
    if (!api) throw new Error('useEditor must be used inside EditorProvider');
    return api;
}

export function useStoreState(): SceneStoreState {
    const { store } = useEditor();
    return useSyncExternalStore(store.subscribe, store.getState);
}
