// Application shell: toolbar, tools, persistent 2D/3D workspace, side panels,
// status bar, file handling, and autosave orchestration.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import sampleJson from '../../samples/simple-studio.draftloom.json';
import { Inspector } from '../editor/inspector/Inspector';
import { DefinitionsPanel } from '../editor/inspector/DefinitionsPanel';
import { NumberField } from '../editor/inspector/fields';
import { PackingPanel } from '../editor/packing/PackingPanel';
import { TOOLS, type OverlayImage, type Tool } from '../editor/tools';
import { SourcePanel, effectiveMatrix } from '../editor/view2d/SourcePanel';
import { TopDownView } from '../editor/view2d/TopDownView';
import { Spatial3DView } from '../editor/viewport3d/Spatial3DView';
import type { Projection } from '../editor/viewport3d/Viewport3D';
import { objectDisplayName } from '../editor/viewport3d/sceneObjects';
import { sceneToGlb } from '../export/glb';
import { NATIVE_EXTENSION, downloadBlob, parseProjectFile, safeFileName, serializeScene } from '../export/nativeJson';
import { sceneToSvg } from '../export/svg';
import { ImportPanel } from '../import/public';
import { boxDimensions, wallLength } from '../scene/geometry';
import { newId } from '../scene/ids';
import { Autosave, ProjectStorage, type SavedProject, type SaveStatus } from '../scene/persistence';
import type { SceneDocument } from '../scene/schema';
import { SceneStore } from '../scene/store';
import { validateScene } from '../scene/validate';
import type { ReconstructionIssue, ReconstructionResult } from '../shared/reconstruction-contract';
import { EditorProvider, useEditor, useStoreState, type NoticeTone } from './EditorContext';
import { applyReconstruction } from './reconstructionIntegration';

type ViewMode = '2d' | '3d' | 'split';

function loadSample(): SceneDocument {
    const v = validateScene(structuredClone(sampleJson));
    if (!v.ok) throw new Error(`Bundled sample scene is invalid: ${v.errors.join('; ')}`);
    return v.scene;
}

function createStorage(): ProjectStorage | null {
    try {
        return typeof indexedDB === 'undefined' ? null : new ProjectStorage(indexedDB);
    } catch {
        return null;
    }
}

function readImageSize(blob: Blob): Promise<{ widthPx: number; heightPx: number }> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(url);
            resolve({ widthPx: image.naturalWidth, heightPx: image.naturalHeight });
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('The selected image could not be decoded.'));
        };
        image.src = url;
    });
}

export function App() {
    const [store] = useState(() => new SceneStore(loadSample()));
    // Dev-only handle for debugging and automated smoke tests; stripped from production builds.
    if (import.meta.env.DEV) (window as unknown as { __draftloomStore?: SceneStore }).__draftloomStore = store;
    const [notice, setNotice] = useState<{ text: string; tone: NoticeTone; n: number } | null>(null);
    const notify = useCallback((text: string, tone: NoticeTone = 'info') => setNotice((p) => ({ text, tone, n: (p?.n ?? 0) + 1 })), []);

    useEffect(() => {
        if (!notice) return;
        const t = setTimeout(() => setNotice(null), notice.tone === 'error' ? 7000 : 4000);
        return () => clearTimeout(t);
    }, [notice]);

    return (
        <EditorProvider store={store} notify={notify}>
            <Workspace notice={notice} />
        </EditorProvider>
    );
}

function Workspace({ notice }: { notice: { text: string; tone: NoticeTone } | null }) {
    const { store, run, notify } = useEditor();
    const state = useStoreState();
    const { scene, selectedId, canUndo, canRedo } = state;

    const [mode, setMode] = useState<ViewMode>('2d');
    const [tool, setTool] = useState<Tool>('select');
    const [projection, setProjection] = useState<Projection>('perspective');
    const definitions = useMemo(() => Object.values(scene.definitions), [scene.definitions]);
    const [activeDefinitionId, setActiveDefinitionId] = useState<string | null>(definitions[0]?.id ?? null);
    const [fitRequest, setFitRequest] = useState(0);
    const [frameRequest, setFrameRequest] = useState<{ n: number; id: string | null }>({ n: 0, id: null });
    const [issues, setIssues] = useState<ReconstructionIssue[]>([]);
    // Set when an imported reconstruction used an assumed scale the user hasn't confirmed yet.
    const [scalePending, setScalePending] = useState(false);
    const [exporting, setExporting] = useState(false);

    // --- Persistence ---
    const storage = useMemo(createStorage, []);
    const autosave = useMemo(() => (storage ? new Autosave(store, storage) : null), [store, storage]);
    const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: 'idle' });
    const [restoreOffer, setRestoreOffer] = useState<SavedProject | null>(null);
    const [autosaveReady, setAutosaveReady] = useState(false);

    useEffect(() => {
        if (!storage) {
            setSaveStatus({ state: 'error', message: 'Local storage (IndexedDB) is unavailable; download your project to keep it.' });
            return;
        }
        let cancelled = false;
        storage
            .loadProject()
            .then((saved) => {
                if (cancelled) return;
                // Autosave waits until the user decides, so it never silently overwrites earlier work.
                if (saved) setRestoreOffer(saved);
                else setAutosaveReady(true);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setSaveStatus({ state: 'error', message: `Could not read saved project: ${err instanceof Error ? err.message : String(err)}` });
                setAutosaveReady(true);
            });
        return () => {
            cancelled = true;
        };
    }, [storage]);

    useEffect(() => {
        if (!autosave || !autosaveReady) return;
        const off = autosave.onStatus(setSaveStatus);
        autosave.start();
        const flush = () => void autosave.flush();
        window.addEventListener('beforeunload', flush);
        document.addEventListener('visibilitychange', flush);
        return () => {
            off();
            autosave.stop();
            window.removeEventListener('beforeunload', flush);
            document.removeEventListener('visibilitychange', flush);
        };
    }, [autosave, autosaveReady]);

    // Keep the active definition valid as definitions change.
    useEffect(() => {
        if (!activeDefinitionId || !scene.definitions[activeDefinitionId]) {
            setActiveDefinitionId(definitions[0]?.id ?? null);
        }
    }, [scene.definitions, definitions, activeDefinitionId]);

    // --- Source image overlay ---
    const [overlayVisible, setOverlayVisible] = useState(true);
    const [overlayOpacity, setOverlayOpacity] = useState(0.5);
    const [image, setImage] = useState<{ key: string; url: string; w: number; h: number } | null>(null);
    const source = scene.sources[0];
    const imageKey = source?.imageKey;

    useEffect(() => {
        if (!imageKey || !storage) {
            setImage(null);
            return;
        }
        if (image?.key === imageKey) return;
        let url: string | null = null;
        let cancelled = false;
        storage
            .getBlob(imageKey)
            .then((blob) => {
                if (!blob || cancelled) {
                    if (!cancelled) setImage(null);
                    return;
                }
                url = URL.createObjectURL(blob);
                const img = new Image();
                img.onload = () => !cancelled && setImage({ key: imageKey, url: url!, w: img.naturalWidth, h: img.naturalHeight });
                img.onerror = () => !cancelled && notify('The stored source image could not be decoded.', 'error');
                img.src = url;
            })
            .catch(() => !cancelled && setImage(null));
        return () => {
            cancelled = true;
        };
    }, [imageKey, storage]); // eslint-disable-line react-hooks/exhaustive-deps

    // Release the previous object URL when the image changes.
    useEffect(() => {
        const url = image?.url;
        return () => {
            if (url) URL.revokeObjectURL(url);
        };
    }, [image]);

    const overlay: OverlayImage | null =
        image && source
            ? {
                  url: image.url,
                  widthPx: source.widthPx ?? image.w,
                  heightPx: source.heightPx ?? image.h,
                  matrix: effectiveMatrix(source),
                  calibrated: !!source.pixelToWorldXZ,
                  visible: overlayVisible,
                  opacity: overlayOpacity,
              }
            : null;

    const loadReferenceImage = async (file: File) => {
        if (!storage) {
            notify('Local storage is unavailable, so the image cannot be kept.', 'error');
            return;
        }
        const key = newId('img');
        try {
            await storage.putBlob(key, file);
        } catch (err) {
            notify(`Could not store the image: ${err instanceof Error ? err.message : String(err)}`, 'error');
            return;
        }
        let dimensions: { widthPx: number; heightPx: number } | undefined;
        try {
            dimensions = await readImageSize(file);
        } catch (err) {
            notify(err instanceof Error ? err.message : String(err), 'error');
        }
        run({
            type: 'setSource',
            source: {
                id: source?.id ?? newId('source'),
                name: file.name,
                mode: source?.mode ?? 'floorplan',
                imageKey: key,
                mimeType: file.type || source?.mimeType,
                widthPx: dimensions?.widthPx ?? source?.widthPx,
                heightPx: dimensions?.heightPx ?? source?.heightPx,
                pixelToWorldXZ: source?.pixelToWorldXZ,
                calibrationMethod: source?.calibrationMethod,
                notes: source?.notes,
            },
        });
        setOverlayVisible(true);
    };

    // --- File handling ---
    const fileInput = useRef<HTMLInputElement>(null);
    const hasWork = state.revision > 0;

    const confirmReplace = (what: string) =>
        !hasWork || window.confirm(`${what} will replace the current project, and the next autosave will overwrite it. Use “Save JSON” first if you want to keep a copy.\n\nContinue?`);

    const fitBothViews = () => {
        setFitRequest((n) => n + 1);
        setFrameRequest((f) => ({ n: f.n + 1, id: null }));
    };

    /** The one editor entry point for reconstruction results (file or live import). Returns an error message on rejection. */
    const acceptReconstruction = async (result: ReconstructionResult, sourceImage?: Blob): Promise<string | null> => {
        const r = await applyReconstruction(store, storage, result, sourceImage);
        if (!r.ok) return `Reconstruction rejected: ${r.errors.slice(0, 3).join('; ')}${r.errors.length > 3 ? ` (+${r.errors.length - 3} more)` : ''}`;
        setIssues(r.issues);
        setScalePending(result.requiresScaleConfirmation);
        if (sourceImage) setOverlayVisible(true);
        fitBothViews();
        notify(`Imported reconstruction with ${r.issues.length} issue${r.issues.length === 1 ? '' : 's'}.${result.requiresScaleConfirmation ? ' Confirm the scale before relying on measurements.' : ''}`);
        return null;
    };

    // Called by the import panel (src/import) once the user accepts a reviewed result.
    // Throwing reports the reason in that panel's status line.
    const onSceneReady = async (result: ReconstructionResult, sourceImage: Blob) => {
        if (!confirmReplace('Importing this drawing')) throw new Error('Import cancelled. The current project was kept.');
        const error = await acceptReconstruction(result, sourceImage);
        if (error) {
            notify(error, 'error');
            throw new Error(error);
        }
    };

    const openFile = async (file: File) => {
        const parsed = parseProjectFile(await file.text());
        if (!parsed.ok) {
            notify(`Could not open ${file.name}: ${parsed.errors.slice(0, 3).join('; ')}${parsed.errors.length > 3 ? ` (+${parsed.errors.length - 3} more)` : ''}`, 'error');
            return;
        }
        if (!confirmReplace(`Opening ${file.name}`)) return;
        if (parsed.kind === 'scene') {
            store.replaceScene(parsed.scene);
            setIssues([]);
            setScalePending(false);
            notify(`Opened ${file.name}.${parsed.scene.sources.some((item) => item.imageKey) ? ' Source images are not included in project files.' : ''}`);
            fitBothViews();
        } else {
            const error = await acceptReconstruction(parsed.result);
            if (error) notify(error, 'error');
        }
    };

    const exportJson = () => {
        const ok = downloadBlob(new Blob([serializeScene(store.getScene())], { type: 'application/json' }), safeFileName(scene.name) + NATIVE_EXTENSION);
        notify(ok ? 'Project file downloaded.' : 'The browser blocked the download.', ok ? 'info' : 'error');
    };

    const exportSvg = () => {
        const ok = downloadBlob(new Blob([sceneToSvg(store.getScene())], { type: 'image/svg+xml' }), safeFileName(scene.name) + '.svg');
        notify(ok ? 'SVG downloaded.' : 'The browser blocked the download.', ok ? 'info' : 'error');
    };

    const exportGlb = async () => {
        setExporting(true);
        try {
            const buf = await sceneToGlb(store.getScene());
            const ok = downloadBlob(new Blob([buf], { type: 'model/gltf-binary' }), safeFileName(scene.name) + '.glb');
            notify(ok ? 'GLB downloaded.' : 'The browser blocked the download.', ok ? 'info' : 'error');
        } catch (err) {
            notify(`GLB export failed: ${err instanceof Error ? err.message : String(err)}. Your project JSON is still available.`, 'error');
        } finally {
            setExporting(false);
        }
    };

    const newProject = () => {
        if (!confirmReplace('A new project')) return;
        run({ type: 'resetScene' });
        setIssues([]);
        setScalePending(false);
        setFitRequest((n) => n + 1);
    };

    const openSample = () => {
        if (!confirmReplace('The sample project')) return;
        store.replaceScene(loadSample());
        setIssues([]);
        setScalePending(false);
        fitBothViews();
    };

    const restore = () => {
        if (!restoreOffer) return;
        store.replaceScene(restoreOffer.scene);
        setRestoreOffer(null);
        setAutosaveReady(true);
        fitBothViews();
    };

    // Keeping the assumed scale leaves its warning listed; confirming one resolves it.
    const scaleDone = (confirmed: boolean) => {
        setScalePending(false);
        if (confirmed) setIssues((list) => list.filter((i) => i.code !== 'SCALE_CONFIRMATION_REQUIRED'));
    };

    const frame = useCallback(() => {
        if (mode !== '2d') setFrameRequest((f) => ({ n: f.n + 1, id: store.getState().selectedId }));
        if (mode !== '3d') setFitRequest((n) => n + 1);
    }, [mode, store]);

    // Global shortcuts.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) store.redo();
                else store.undo();
                return;
            }
            if (mod && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                store.redo();
                return;
            }
            if (mod && e.key.toLowerCase() === 's') {
                e.preventDefault();
                exportJson();
                return;
            }
            if (mod || e.altKey) return;
            const toolHit = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
            if (toolHit) setTool(toolHit.id);
            else if (e.key.toLowerCase() === 'f') frame();
            else if (e.key === '1') setMode('2d');
            else if (e.key === '2') setMode('3d');
            else if (e.key === '3') setMode('split');
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }); // re-bound each render so handlers see current state

    const selected = scene.objects.find((o) => o.id === selectedId);
    const show2d = mode !== '3d';
    const show3d = mode !== '2d';
    const toolHint = TOOLS.find((t) => t.id === tool)?.hint ?? '';

    return (
        <div className="app">
            <header className="toolbar">
                <div className="brand">
                    <span className="logo" aria-hidden>
                        ◆
                    </span>
                    Draftloom
                </div>
                <input className="scene-name" value={scene.name} aria-label="Project name" onChange={(e) => store.previewCommand({ type: 'renameScene', name: e.target.value })} onBlur={(e) => run({ type: 'renameScene', name: e.target.value })} />
                <div className="group">
                    <button onClick={newProject}>New</button>
                    <button onClick={() => fileInput.current?.click()}>Open…</button>
                    <button onClick={openSample}>Sample</button>
                    <button onClick={() => document.getElementById('import-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} title="Photo or QR phone upload">
                        Import drawing
                    </button>
                    <input
                        ref={fileInput}
                        type="file"
                        accept=".json,application/json"
                        hidden
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void openFile(f);
                            e.target.value = '';
                        }}
                    />
                </div>
                <div className="group">
                    <button onClick={() => store.undo()} disabled={!canUndo} title="Undo (Ctrl+Z)">
                        Undo
                    </button>
                    <button onClick={() => store.redo()} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
                        Redo
                    </button>
                </div>
                <div className="segmented" role="tablist" aria-label="View">
                    {(['2d', '3d', 'split'] as const).map((m, i) => (
                        <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)} title={`Key ${i + 1}`}>
                            {m === 'split' ? 'Split' : m.toUpperCase()}
                        </button>
                    ))}
                </div>
                {show3d && (
                    <div className="segmented" aria-label="Camera projection">
                        <button className={projection === 'perspective' ? 'on' : ''} onClick={() => setProjection('perspective')}>
                            Persp
                        </button>
                        <button className={projection === 'orthographic' ? 'on' : ''} onClick={() => setProjection('orthographic')}>
                            Ortho
                        </button>
                    </div>
                )}
                <button onClick={frame} title="Frame selection (F)">
                    Frame
                </button>
                <div className="spacer" />
                <div className="group">
                    <button onClick={exportJson} title="Download .draftloom.json (Ctrl+S)">
                        Save JSON
                    </button>
                    <button onClick={exportSvg}>Export SVG</button>
                    <button onClick={() => void exportGlb()} disabled={exporting}>
                        {exporting ? 'Exporting…' : 'Export GLB'}
                    </button>
                </div>
                <SaveIndicator status={saveStatus} paused={!autosaveReady && !!storage} />
            </header>

            {restoreOffer && (
                <div className="banner">
                    <span>
                        Found an autosaved project “{restoreOffer.scene.name}” from {new Date(restoreOffer.savedAt).toLocaleString()}. Autosave is paused until you choose.
                    </span>
                    <button className="primary" onClick={restore}>
                        Restore last Draftloom project
                    </button>
                    <button
                        onClick={() => {
                            setRestoreOffer(null);
                            setAutosaveReady(true);
                        }}
                    >
                        Keep current (overwrites autosave)
                    </button>
                </div>
            )}

            <nav className="tools" aria-label="Tools">
                {TOOLS.map((t) => (
                    <button key={t.id} className={tool === t.id ? 'on' : ''} onClick={() => setTool(t.id)} title={`${t.label} (${t.key}) — ${t.hint}`} disabled={!show2d && t.id !== 'select'}>
                        <span className="tool-label">{t.label}</span>
                        <kbd>{t.key}</kbd>
                    </button>
                ))}
            </nav>

            <main className={`workspace mode-${mode}`}>
                <div className="pane pane-2d" hidden={!show2d}>
                    <TopDownView tool={tool} activeDefinitionId={activeDefinitionId} gridSnap={scene.settings.gridSnap} overlay={overlay} fitRequest={fitRequest} onToolDone={() => setTool('select')} />
                    <div className="pane-hint">{toolHint}</div>
                </div>
                <div className="pane pane-3d" hidden={!show3d}>
                    <Spatial3DView visible={show3d} projection={projection} frameRequest={frameRequest} />
                </div>
            </main>

            <aside className="sidebar">
                {scalePending && <ScalePanel onDone={scaleDone} />}
                <Inspector />
                <DefinitionsPanel activeDefinitionId={activeDefinitionId} onActivate={(id) => setActiveDefinitionId(id)} />
                <PackingPanel activeDefinitionId={activeDefinitionId} />
                <IssuesPanel issues={issues} onClear={() => setIssues([])} />
                <SourcePanel hasImage={!!image} visible={overlayVisible} opacity={overlayOpacity} onVisible={setOverlayVisible} onOpacity={setOverlayOpacity} onLoadImage={(f) => void loadReferenceImage(f)} />
                {/* Import UI owned by the reconstruction module; the editor only supplies onSceneReady. */}
                <div className="panel import-host" id="import-panel">
                    <ImportPanel onSceneReady={onSceneReady} />
                </div>
            </aside>

            <footer className="statusbar">
                <span>{selected ? `${selected.kind}: ${objectDisplayName(selected, scene.definitions)}` : 'Nothing selected'}</span>
                <span>Units: m</span>
                <label>
                    Snap
                    <select value={String(scene.settings.snapAngleDeg)} onChange={(e) => run({ type: 'updateSettings', patch: { snapAngleDeg: Number(e.target.value) as 0 | 15 | 45 | 90 } })}>
                        <option value="90">90°</option>
                        <option value="45">45°</option>
                        <option value="15">15°</option>
                        <option value="0">Free</option>
                    </select>
                </label>
                <label>
                    ±
                    <input className="tiny" type="number" min={0} max={45} value={scene.settings.snapToleranceDeg} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && run({ type: 'updateSettings', patch: { snapToleranceDeg: Math.min(45, Math.max(0, e.target.valueAsNumber)) } })} />°
                </label>
                <label>
                    <input type="checkbox" checked={scene.settings.gridSnap} onChange={(e) => run({ type: 'updateSettings', patch: { gridSnap: e.target.checked } })} /> Grid
                    <select value={scene.settings.gridSizeM} onChange={(e) => run({ type: 'updateSettings', patch: { gridSizeM: Number(e.target.value) } })}>
                        {[0.05, 0.1, 0.25, 0.5, 1].map((g) => (
                            <option key={g} value={g}>
                                {g} m
                            </option>
                        ))}
                    </select>
                </label>
                {scalePending && <span className="warn">Scale not confirmed</span>}
                {issues.length > 0 && <span className="warn">{issues.length} import issue{issues.length === 1 ? '' : 's'}</span>}
                <span className="spacer" />
                {notice && <span className={`notice ${notice.tone}`}>{notice.text}</span>}
            </footer>
        </div>
    );
}

function SaveIndicator({ status, paused }: { status: SaveStatus; paused: boolean }) {
    if (paused) return <span className="save-indicator muted">Autosave paused</span>;
    const text = { idle: 'Autosave on', pending: 'Unsaved…', saving: 'Saving…', saved: 'Saved', error: 'Save error' }[status.state];
    const title = status.state === 'error' ? status.message : status.state === 'saved' ? `Saved locally at ${new Date(status.at).toLocaleTimeString()}` : 'Saved to this browser (IndexedDB)';
    return (
        <span className={`save-indicator ${status.state}`} title={title}>
            {text}
        </span>
    );
}

/** Confirms an assumed import scale from one known real dimension, then rescales the scene uniformly. */
function ScalePanel({ onDone }: { onDone(confirmed: boolean): void }) {
    const { run, notify } = useEditor();
    const { scene, selectedId } = useStoreState();
    const selected = scene.objects.find((o) => o.id === selectedId);
    const measured =
        selected?.kind === 'wall'
            ? { what: 'wall length', meters: wallLength(selected) }
            : selected?.kind === 'box'
              ? { what: 'box width (X)', meters: boxDimensions(selected, scene.definitions)[0] }
              : null;

    const apply = (realMeters: number) => {
        if (!measured || measured.meters <= 0 || !(realMeters > 0)) return;
        const factor = realMeters / measured.meters;
        // A floor-plan scale says nothing about heights (they are separate defaults);
        // an isometric reconstruction derives heights from the same image scale.
        const includeHeights = scene.sources[0]?.mode === 'isometric';
        // The user's measurement now defines the image calibration, so it becomes manual.
        if (run({ type: 'scaleScene', factor, includeHeights, calibration: 'manual' })) {
            notify(`${includeHeights ? 'Scene' : 'Plan'} rescaled ×${factor.toFixed(4)} from the known ${measured.what}${includeHeights ? '' : '; heights unchanged'}. Undo reverts it.`);
            onDone(true);
        }
    };

    return (
        <section className="panel scale-panel">
            <h2>Scale not confirmed</h2>
            <p className="muted small">This reconstruction used a provisional scale, so its sizes are proportional, not measured. Select a wall or box whose real size you know and enter it; the plan and its source overlay are rescaled together. Heights are separate defaults, so check them in the inspector.</p>
            {measured ? (
                <>
                    <p className="readout">
                        Current {measured.what}: {measured.meters.toFixed(3)} m
                    </p>
                    <NumberField label={`Real ${measured.what}`} unit="m" min={0.001} step={0.01} value={measured.meters} onCommit={apply} />
                </>
            ) : (
                <p className="muted small">Select a wall or box in either view.</p>
            )}
            <button
                className="link-button"
                onClick={() => {
                    notify('Keeping the provisional scale. Dimensions are approximate.');
                    onDone(false);
                }}
            >
                Keep provisional scale
            </button>
        </section>
    );
}

function IssuesPanel({ issues, onClear }: { issues: ReconstructionIssue[]; onClear(): void }) {
    const { store } = useEditor();
    if (issues.length === 0) return null;
    return (
        <section className="panel">
            <h2>
                Import issues
                <button className="small-button" onClick={onClear}>
                    Dismiss
                </button>
            </h2>
            <ul className="issues">
                {issues.map((i, index) => {
                    const targetId = i.objectId ?? i.objectIds?.[0];
                    return (
                        <li key={i.id ?? `${i.code}-${targetId ?? index}`} className={`issue ${i.severity}`}>
                            <button className="issue-button" disabled={!targetId} onClick={() => targetId && store.setSelectedId(targetId)}>
                                <span className="sev">{i.severity}</span> {i.message}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
