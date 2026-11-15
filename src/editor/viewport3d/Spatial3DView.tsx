// React host for the persistent Three.js viewport. Mounted once; visibility
// changes only pause rendering so camera, geometry, and canvas survive.
import { useEffect, useRef, useState } from 'react';
import { useEditor, useStoreState } from '../../app/EditorContext';
import { Viewport3D, type Projection } from './Viewport3D';

interface Props {
    visible: boolean;
    projection: Projection;
    /** Increment with an id (or null for all) to frame the camera. */
    frameRequest: { n: number; id: string | null };
}

export function Spatial3DView({ visible, projection, frameRequest }: Props) {
    const { store } = useEditor();
    const { displayScene, selectedId } = useStoreState();
    const hostRef = useRef<HTMLDivElement>(null);
    const viewportRef = useRef<Viewport3D | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        let vp: Viewport3D;
        try {
            vp = new Viewport3D(host, { onSelect: (id) => store.setSelectedId(id) });
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            return;
        }
        viewportRef.current = vp;
        const canvas = vp.renderer.domElement;
        const onLost = (e: Event) => {
            e.preventDefault();
            setError('The WebGL context was lost. The 2D editor and saving still work; reload to restore 3D.');
        };
        canvas.addEventListener('webglcontextlost', onLost);
        const s = store.getState();
        vp.sync(s.displayScene, s.selectedId);
        return () => {
            canvas.removeEventListener('webglcontextlost', onLost);
            vp.dispose();
            viewportRef.current = null;
        };
    }, [store]);

    useEffect(() => {
        viewportRef.current?.sync(displayScene, selectedId);
    }, [displayScene, selectedId]);

    useEffect(() => {
        viewportRef.current?.setActive(visible);
    }, [visible]);

    useEffect(() => {
        viewportRef.current?.setProjection(projection);
    }, [projection]);

    useEffect(() => {
        if (frameRequest.n > 0) viewportRef.current?.frame(frameRequest.id);
    }, [frameRequest]);

    return (
        <div className="viewport3d" ref={hostRef}>
            {error ? (
                <div className="viewport3d-error" role="alert">
                    <strong>3D view unavailable.</strong>
                    <p>{error}</p>
                    <p>WebGL may be disabled or unsupported in this browser. The 2D editor, autosave, and exports still work.</p>
                </div>
            ) : (
                <div className="control-hint">
                    <span>LMB select</span>
                    <span>MMB orbit</span>
                    <span>Shift+MMB / RMB pan</span>
                    <span>Wheel zoom</span>
                    <span>F frame</span>
                </div>
            )}
        </div>
    );
}
