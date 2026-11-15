// Top-down SVG editor. World X maps to screen x and world Z to screen y
// (+Z is visually DOWN). All geometry is derived from scene state; drags
// render as store previews and commit one command on pointer release.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useEditor, useStoreState } from '../../app/EditorContext';
import type { SceneCommand } from '../../scene/commands';
import {
    boundsOf,
    boxDimensions,
    boxFootprint,
    distance,
    polygonArea,
    polygonCentroid,
    snapAngle,
    snapToGrid,
    wallFootprint,
    wallLength,
} from '../../scene/geometry';
import { newId } from '../../scene/ids';
import type { SceneDocument, Vec2 } from '../../scene/schema';
import { objectDisplayName } from '../viewport3d/sceneObjects';
import { DEFAULT_WALL_HEIGHT_M, DEFAULT_WALL_THICKNESS_M, type OverlayImage, type Tool } from '../tools';

interface ViewTransform {
    /** Screen pixels per meter. */
    zoom: number;
    panX: number;
    panY: number;
}

type Drag =
    | { kind: 'box'; id: string; start: Vec2; orig: [number, number, number] }
    | { kind: 'wall'; id: string; start: Vec2; origStart: Vec2; origEnd: Vec2 }
    | { kind: 'wallEnd'; id: string; endpoint: 'start' | 'end'; anchor: Vec2 }
    | { kind: 'region'; id: string; start: Vec2; orig: Vec2[] }
    | { kind: 'vertex'; id: string; index: number }
    | { kind: 'pan'; startX: number; startY: number; orig: ViewTransform };

interface Props {
    tool: Tool;
    activeDefinitionId: string | null;
    overlay: OverlayImage | null;
    /** Increment to refit the view to the scene. */
    fitRequest: number;
    onToolDone?: () => void;
}

const MIN_ZOOM = 4;
const MAX_ZOOM = 2000;
const HANDLE_PX = 6;
const DRAG_THRESHOLD_PX = 3;

function fitTransform(scene: SceneDocument, width: number, height: number): ViewTransform {
    const pts: Vec2[] = [];
    for (const o of scene.objects) {
        if (o.kind === 'box') pts.push(...boxFootprint(o, scene.definitions));
        else if (o.kind === 'wall') pts.push(o.start, o.end);
        else pts.push(...o.polygon);
    }
    if (pts.length === 0) pts.push([-5, -5], [5, 5]);
    const b = boundsOf(pts);
    const w = Math.max(b.maxX - b.minX, 1);
    const h = Math.max(b.maxZ - b.minZ, 1);
    const zoom = Math.min(Math.max(Math.min((width * 0.85) / w, (height * 0.85) / h), MIN_ZOOM), MAX_ZOOM);
    return {
        zoom,
        panX: width / 2 - ((b.minX + b.maxX) / 2) * zoom,
        panY: height / 2 - ((b.minZ + b.maxZ) / 2) * zoom,
    };
}

export function TopDownView({ tool, activeDefinitionId, overlay, fitRequest, onToolDone }: Props) {
    const { store, run, notify } = useEditor();
    const { displayScene: scene, selectedId } = useStoreState();
    const svgRef = useRef<SVGSVGElement>(null);
    const worldRef = useRef<SVGGElement>(null);
    const [view, setView] = useState<ViewTransform>({ zoom: 60, panX: 100, panY: 100 });
    const viewRef = useRef(view);
    viewRef.current = view;
    const drag = useRef<Drag | null>(null);
    const dragMoved = useRef(false);
    const pending = useRef<SceneCommand | null>(null);
    const downAt = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const [spaceHeld, setSpaceHeld] = useState(false);
    const [cursor, setCursor] = useState<Vec2 | null>(null);
    const [wallStart, setWallStart] = useState<Vec2 | null>(null);
    const [regionPts, setRegionPts] = useState<Vec2[]>([]);
    const settings = scene.settings;

    // Fit on first layout and whenever a refit is requested.
    useLayoutEffect(() => {
        const svg = svgRef.current;
        if (!svg) return;
        const r = svg.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) setView(fitTransform(store.getScene(), r.width, r.height));
    }, [fitRequest, store]);

    // Keep the same world point centered when the pane resizes (e.g. entering split view).
    useEffect(() => {
        const svg = svgRef.current;
        if (!svg) return;
        let last = { w: svg.clientWidth, h: svg.clientHeight };
        const ro = new ResizeObserver(() => {
            const w = svg.clientWidth;
            const h = svg.clientHeight;
            if (w === 0 || h === 0) return; // hidden: keep last size
            if (last.w > 0 && last.h > 0 && (w !== last.w || h !== last.h)) {
                const dx = (w - last.w) / 2;
                const dy = (h - last.h) / 2;
                setView((v) => ({ ...v, panX: v.panX + dx, panY: v.panY + dy }));
            }
            last = { w, h };
        });
        ro.observe(svg);
        return () => ro.disconnect();
    }, []);

    // Reset in-progress drawing when switching tools.
    useEffect(() => {
        setWallStart(null);
        setRegionPts([]);
    }, [tool]);

    const toWorld = useCallback((clientX: number, clientY: number): Vec2 => {
        const g = worldRef.current;
        const ctm = g?.getScreenCTM();
        if (!g || !ctm) return [0, 0];
        const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
        return [p.x, p.y];
    }, []);

    const snapPoint = useCallback(
        (p: Vec2): Vec2 => (settings.gridSnap ? snapToGrid(p, settings.gridSizeM) : p),
        [settings.gridSnap, settings.gridSizeM],
    );

    // Snap a drawn endpoint by angle relative to an anchor, then optionally to the grid.
    const snapFrom = useCallback(
        (anchor: Vec2, p: Vec2): Vec2 => {
            const angled = snapAngle(anchor, p, settings.snapAngle, settings.snapToleranceDeg);
            return settings.gridSnap && settings.snapAngle === 'free' ? snapToGrid(angled, settings.gridSizeM) : angled;
        },
        [settings],
    );

    // Wheel zoom around the cursor (native listener so we can preventDefault).
    useEffect(() => {
        const svg = svgRef.current;
        if (!svg) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = svg.getBoundingClientRect();
            const sx = e.clientX - rect.left;
            const sy = e.clientY - rect.top;
            setView((v) => {
                const factor = Math.exp(-e.deltaY * 0.0015);
                const zoom = Math.min(Math.max(v.zoom * factor, MIN_ZOOM), MAX_ZOOM);
                const wx = (sx - v.panX) / v.zoom;
                const wz = (sy - v.panY) / v.zoom;
                return { zoom, panX: sx - wx * zoom, panY: sy - wz * zoom };
            });
        };
        svg.addEventListener('wheel', onWheel, { passive: false });
        return () => svg.removeEventListener('wheel', onWheel);
    }, []);

    const finishWall = useCallback(() => {
        setWallStart(null);
    }, []);

    const closeRegion = useCallback(
        (pts: Vec2[]) => {
            if (pts.length < 3) {
                notify('A region needs at least 3 vertices.', 'error');
                return;
            }
            const id = newId('region');
            const count = scene.objects.filter((o) => o.kind === 'region').length + 1;
            if (run({ type: 'addRegion', region: { kind: 'region', id, name: `Region ${count}`, polygon: pts, provenance: { origin: 'manual' } } })) {
                store.setSelectedId(id);
                setRegionPts([]);
                onToolDone?.();
            }
        },
        [notify, run, scene.objects, store, onToolDone],
    );

    // Keyboard: Space pans, Esc cancels drawing, Enter closes regions, Delete removes selection.
    useEffect(() => {
        const isTyping = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null;
            return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
        };
        const down = (e: KeyboardEvent) => {
            if (isTyping(e)) return;
            if (e.code === 'Space') {
                setSpaceHeld(true);
                e.preventDefault();
            } else if (e.key === 'Escape') {
                if (wallStart) finishWall();
                else if (regionPts.length > 0) setRegionPts([]);
                else store.setSelectedId(null);
            } else if (e.key === 'Enter' && tool === 'region' && regionPts.length >= 3) {
                closeRegion(regionPts);
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && store.getState().selectedId) {
                run({ type: 'deleteObject', id: store.getState().selectedId! });
            }
        };
        const up = (e: KeyboardEvent) => {
            if (e.code === 'Space') setSpaceHeld(false);
        };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        return () => {
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
        };
    }, [wallStart, regionPts, tool, closeRegion, finishWall, run, store]);

    const startDrag = (e: ReactPointerEvent, d: Drag) => {
        e.stopPropagation();
        drag.current = d;
        dragMoved.current = false;
        pending.current = null;
        downAt.current = { x: e.clientX, y: e.clientY };
        svgRef.current?.setPointerCapture(e.pointerId);
    };

    const onObjectPointerDown = (e: ReactPointerEvent, id: string) => {
        if (e.button !== 0 || tool !== 'select' || spaceHeld) return;
        store.setSelectedId(id);
        const o = scene.objects.find((x) => x.id === id);
        if (!o) return;
        const start = toWorld(e.clientX, e.clientY);
        if (o.kind === 'box') startDrag(e, { kind: 'box', id, start, orig: [...o.position] });
        else if (o.kind === 'wall') startDrag(e, { kind: 'wall', id, start, origStart: o.start, origEnd: o.end });
        else startDrag(e, { kind: 'region', id, start, orig: o.polygon });
    };

    const onBackgroundPointerDown = (e: ReactPointerEvent) => {
        const panning = e.button === 1 || (e.button === 0 && (spaceHeld || tool === 'pan'));
        if (panning) {
            e.preventDefault();
            startDrag(e, { kind: 'pan', startX: e.clientX, startY: e.clientY, orig: viewRef.current });
            return;
        }
        if (e.button === 2) {
            // Right-click finishes a wall chain.
            if (wallStart) finishWall();
            return;
        }
        if (e.button !== 0) return;
        const raw = toWorld(e.clientX, e.clientY);
        if (tool === 'select') {
            store.setSelectedId(null);
        } else if (tool === 'box') {
            if (!activeDefinitionId) {
                notify('Create or choose a definition first (Definitions panel).', 'error');
                return;
            }
            const p = snapPoint(raw);
            const id = newId('box');
            if (run({ type: 'addBox', box: { kind: 'box', id, definitionId: activeDefinitionId, position: [p[0], 0, p[1]], yaw: 0, provenance: { origin: 'manual' } } })) {
                store.setSelectedId(id);
            }
        } else if (tool === 'wall') {
            if (!wallStart) {
                setWallStart(snapPoint(raw));
                return;
            }
            const end = snapFrom(wallStart, raw);
            if (distance(wallStart, end) < 0.05) {
                finishWall();
                return;
            }
            const id = newId('wall');
            const ok = run({
                type: 'addWall',
                wall: { kind: 'wall', id, start: wallStart, end, heightM: DEFAULT_WALL_HEIGHT_M, thicknessM: DEFAULT_WALL_THICKNESS_M, provenance: { origin: 'manual' } },
            });
            if (ok) {
                store.setSelectedId(id);
                setWallStart(end);
            }
        } else if (tool === 'region') {
            const p = regionPts.length > 0 ? snapFrom(regionPts[regionPts.length - 1], raw) : snapPoint(raw);
            if (regionPts.length >= 3 && distance(p, regionPts[0]) * viewRef.current.zoom < HANDLE_PX * 2) {
                closeRegion(regionPts);
                return;
            }
            setRegionPts([...regionPts, p]);
        }
    };

    const onPointerMove = (e: ReactPointerEvent) => {
        const raw = toWorld(e.clientX, e.clientY);
        if (tool === 'wall' || tool === 'region') setCursor(raw);
        const d = drag.current;
        if (!d) return;
        if (!dragMoved.current && Math.hypot(e.clientX - downAt.current.x, e.clientY - downAt.current.y) < DRAG_THRESHOLD_PX) return;
        dragMoved.current = true;
        if (d.kind === 'pan') {
            setView({ ...d.orig, panX: d.orig.panX + e.clientX - d.startX, panY: d.orig.panY + e.clientY - d.startY });
            return;
        }
        let cmd: SceneCommand;
        if (d.kind === 'box') {
            const p = snapPoint([d.orig[0] + raw[0] - d.start[0], d.orig[2] + raw[1] - d.start[1]]);
            cmd = { type: 'moveBox', id: d.id, position: [p[0], d.orig[1], p[1]] };
        } else if (d.kind === 'wall') {
            let dx = raw[0] - d.start[0];
            let dz = raw[1] - d.start[1];
            if (settings.gridSnap) [dx, dz] = snapToGrid([dx, dz], settings.gridSizeM);
            cmd = { type: 'moveWall', id: d.id, start: [d.origStart[0] + dx, d.origStart[1] + dz], end: [d.origEnd[0] + dx, d.origEnd[1] + dz] };
        } else if (d.kind === 'wallEnd') {
            cmd = { type: 'moveWallEndpoint', id: d.id, endpoint: d.endpoint, point: snapFrom(d.anchor, raw) };
        } else if (d.kind === 'region') {
            let dx = raw[0] - d.start[0];
            let dz = raw[1] - d.start[1];
            if (settings.gridSnap) [dx, dz] = snapToGrid([dx, dz], settings.gridSizeM);
            cmd = { type: 'setRegionPolygon', id: d.id, polygon: d.orig.map(([x, z]) => [x + dx, z + dz] as Vec2) };
        } else {
            cmd = { type: 'moveRegionVertex', id: d.id, index: d.index, point: snapPoint(raw) };
        }
        // Invalid intermediate states (e.g. a self-intersecting region) keep the last valid preview.
        if (store.previewCommand(cmd)) pending.current = cmd;
    };

    const onPointerUp = (e: ReactPointerEvent) => {
        const d = drag.current;
        drag.current = null;
        if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
        if (!d || d.kind === 'pan') return;
        const cmd = pending.current;
        pending.current = null;
        if (cmd && dragMoved.current) run(cmd);
        else store.setPreview(null);
    };

    const handleR = HANDLE_PX / view.zoom;
    const fontSize = 12 / view.zoom;
    const strokeW = 1.5 / view.zoom;
    const defsById = useMemo(() => new Map(scene.definitions.map((d) => [d.id, d])), [scene.definitions]);
    const selected = scene.objects.find((o) => o.id === selectedId) ?? null;
    const grid = settings.gridSizeM;

    const wallPreviewEnd = wallStart && cursor ? snapFrom(wallStart, cursor) : null;
    const regionPreview = tool === 'region' && regionPts.length > 0 && cursor ? snapFrom(regionPts[regionPts.length - 1], cursor) : null;
    const cursorStyle = drag.current?.kind === 'pan' || spaceHeld || tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';

    return (
        <svg
            ref={svgRef}
            className="topdown"
            style={{ cursor: cursorStyle }}
            onPointerDown={onBackgroundPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => setCursor(null)}
            onContextMenu={(e) => e.preventDefault()}
            onDoubleClick={() => {
                if (tool === 'region' && regionPts.length >= 3) closeRegion(regionPts);
                else if (tool === 'wall') finishWall();
            }}
        >
            <defs>
                <pattern id="grid-minor" width={grid} height={grid} patternUnits="userSpaceOnUse">
                    <path d={`M ${grid} 0 L 0 0 0 ${grid}`} fill="none" stroke="var(--grid-minor)" strokeWidth={1 / view.zoom} />
                </pattern>
            </defs>
            <g ref={worldRef} transform={`translate(${view.panX} ${view.panY}) scale(${view.zoom})`}>
                {overlay && overlay.visible && (
                    <image
                        href={overlay.url}
                        width={overlay.widthPx}
                        height={overlay.heightPx}
                        opacity={overlay.opacity}
                        transform={`matrix(${overlay.matrix[0]} ${overlay.matrix[3]} ${overlay.matrix[1]} ${overlay.matrix[4]} ${overlay.matrix[2]} ${overlay.matrix[5]})`}
                        preserveAspectRatio="none"
                        pointerEvents="none"
                    />
                )}
                <rect x={-500} y={-500} width={1000} height={1000} fill="url(#grid-minor)" pointerEvents="none" />
                <line x1={-500} y1={0} x2={500} y2={0} stroke="var(--axis-x)" strokeWidth={strokeW} pointerEvents="none" />
                <line x1={0} y1={-500} x2={0} y2={500} stroke="var(--axis-z)" strokeWidth={strokeW} pointerEvents="none" />

                {scene.objects.map((o) => {
                    if (o.kind !== 'region') return null;
                    const color = o.color ?? '#6aa84f';
                    const sel = o.id === selectedId;
                    const [cx, cz] = polygonCentroid(o.polygon);
                    return (
                        <g key={o.id} className="obj" onPointerDown={(e) => onObjectPointerDown(e, o.id)}>
                            <polygon
                                points={o.polygon.map((p) => p.join(',')).join(' ')}
                                fill={color}
                                fillOpacity={sel ? 0.28 : 0.16}
                                stroke={sel ? 'var(--accent)' : color}
                                strokeWidth={strokeW * (sel ? 2 : 1)}
                                strokeDasharray={`${8 / view.zoom} ${4 / view.zoom}`}
                            />
                            <text x={cx} y={cz} fontSize={fontSize} className="label region-label" pointerEvents="none">
                                {o.name}
                            </text>
                        </g>
                    );
                })}

                {scene.objects.map((o) => {
                    if (o.kind !== 'wall') return null;
                    const fp = wallFootprint(o);
                    if (fp.length === 0) return null;
                    const sel = o.id === selectedId;
                    return (
                        <polygon
                            key={o.id}
                            className="obj"
                            points={fp.map((p) => p.join(',')).join(' ')}
                            fill={sel ? 'var(--accent)' : 'var(--wall)'}
                            stroke={sel ? 'var(--accent)' : 'var(--wall-edge)'}
                            strokeWidth={strokeW}
                            onPointerDown={(e) => onObjectPointerDown(e, o.id)}
                        />
                    );
                })}

                {scene.objects.map((o) => {
                    if (o.kind !== 'box') return null;
                    const def = defsById.get(o.definitionId);
                    const color = def?.color ?? '#999999';
                    const fp = boxFootprint(o, scene.definitions);
                    const sel = o.id === selectedId;
                    const uncertain = o.provenance?.inferred || (o.provenance?.confidence ?? 1) < 0.6;
                    // Local +X axis marker shows facing (yaw) in the top-down view.
                    const [w] = boxDimensions(o, scene.definitions);
                    const front: Vec2 = [o.position[0] + Math.cos(o.yaw) * (w / 2), o.position[2] - Math.sin(o.yaw) * (w / 2)];
                    return (
                        <g key={o.id} className="obj" onPointerDown={(e) => onObjectPointerDown(e, o.id)}>
                            <polygon
                                points={fp.map((p) => p.join(',')).join(' ')}
                                fill={color}
                                fillOpacity={uncertain ? 0.3 : 0.6}
                                stroke={sel ? 'var(--accent)' : color}
                                strokeWidth={strokeW * (sel ? 2.2 : 1)}
                                strokeDasharray={uncertain ? `${4 / view.zoom} ${3 / view.zoom}` : undefined}
                            />
                            <line x1={o.position[0]} y1={o.position[2]} x2={front[0]} y2={front[1]} stroke="var(--ink)" strokeOpacity={0.5} strokeWidth={strokeW} pointerEvents="none" />
                            <text x={o.position[0]} y={o.position[2]} fontSize={fontSize * 0.9} className="label" pointerEvents="none">
                                {objectDisplayName(o, scene.definitions)}
                            </text>
                        </g>
                    );
                })}

                {/* Selection handles */}
                {selected?.kind === 'wall' && tool === 'select' && (
                    <g>
                        <text x={(selected.start[0] + selected.end[0]) / 2} y={(selected.start[1] + selected.end[1]) / 2 - fontSize} fontSize={fontSize} className="label measure" pointerEvents="none">
                            {wallLength(selected).toFixed(2)} m
                        </text>
                        {(['start', 'end'] as const).map((ep) => (
                            <circle
                                key={ep}
                                className="handle"
                                cx={selected[ep][0]}
                                cy={selected[ep][1]}
                                r={handleR}
                                strokeWidth={strokeW}
                                onPointerDown={(e) => {
                                    if (e.button !== 0) return;
                                    startDrag(e, { kind: 'wallEnd', id: selected.id, endpoint: ep, anchor: ep === 'start' ? selected.end : selected.start });
                                }}
                            />
                        ))}
                    </g>
                )}
                {selected?.kind === 'region' && tool === 'select' && (
                    <g>
                        {selected.polygon.map((p, i) => (
                            <rect
                                key={i}
                                className="handle"
                                x={p[0] - handleR}
                                y={p[1] - handleR}
                                width={handleR * 2}
                                height={handleR * 2}
                                strokeWidth={strokeW}
                                onPointerDown={(e) => {
                                    if (e.button !== 0) return;
                                    startDrag(e, { kind: 'vertex', id: selected.id, index: i });
                                }}
                            />
                        ))}
                        <text x={polygonCentroid(selected.polygon)[0]} y={polygonCentroid(selected.polygon)[1] + fontSize * 1.3} fontSize={fontSize * 0.9} className="label measure" pointerEvents="none">
                            {polygonArea(selected.polygon).toFixed(2)} m²
                        </text>
                    </g>
                )}

                {/* In-progress drawing */}
                {tool === 'wall' && wallStart && (
                    <g pointerEvents="none">
                        <circle cx={wallStart[0]} cy={wallStart[1]} r={handleR * 0.7} className="draw-point" />
                        {wallPreviewEnd && (
                            <>
                                <line x1={wallStart[0]} y1={wallStart[1]} x2={wallPreviewEnd[0]} y2={wallPreviewEnd[1]} className="draw-line" strokeWidth={DEFAULT_WALL_THICKNESS_M} />
                                <text x={wallPreviewEnd[0]} y={wallPreviewEnd[1] - fontSize} fontSize={fontSize} className="label measure">
                                    {distance(wallStart, wallPreviewEnd).toFixed(2)} m
                                </text>
                            </>
                        )}
                    </g>
                )}
                {tool === 'region' && regionPts.length > 0 && (
                    <g pointerEvents="none">
                        <polyline points={[...regionPts, ...(regionPreview ? [regionPreview] : [])].map((p) => p.join(',')).join(' ')} className="draw-region" strokeWidth={strokeW * 1.5} />
                        {regionPts.map((p, i) => (
                            <circle key={i} cx={p[0]} cy={p[1]} r={handleR * (i === 0 ? 1 : 0.6)} className="draw-point" />
                        ))}
                    </g>
                )}
            </g>
            {overlay && overlay.visible && !overlay.calibrated && (
                <text x={12} y={20} className="overlay-note">
                    Reference image is uncalibrated — align it in the Source panel.
                </text>
            )}
            <g className="scale-bar" transform="translate(16, 0)">
                <ScaleBar zoom={view.zoom} svgRef={svgRef} />
            </g>
        </svg>
    );
}

function ScaleBar({ zoom, svgRef }: { zoom: number; svgRef: React.RefObject<SVGSVGElement | null> }) {
    const h = svgRef.current?.clientHeight ?? 400;
    // Pick a round length that is ~80-200 px on screen.
    const candidates = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
    const len = candidates.find((c) => c * zoom >= 80) ?? 100;
    const px = len * zoom;
    return (
        <g transform={`translate(0 ${h - 20})`} pointerEvents="none">
            <line x1={0} y1={0} x2={px} y2={0} className="scale-line" />
            <line x1={0} y1={-4} x2={0} y2={4} className="scale-line" />
            <line x1={px} y1={-4} x2={px} y2={4} className="scale-line" />
            <text x={px / 2} y={-6} className="scale-text">
                {len < 1 ? `${len * 100} cm` : `${len} m`}
            </text>
        </g>
    );
}
