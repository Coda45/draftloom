// Source image overlay: visibility, opacity, and manual pixel -> world alignment.
import { useEditor, useStoreState } from '../../app/EditorContext';
import type { SourceReference } from '../../scene/schema';
import { NumberField } from '../inspector/fields';

export const DEFAULT_METERS_PER_PIXEL = 0.01;

/** Similarity transform: uniform scale, rotation, then translation. */
export function similarityMatrix(metersPerPixel: number, rotationRad: number, originX: number, originZ: number): NonNullable<SourceReference['pixelToWorldXZ']> {
    const c = Math.cos(rotationRad) * metersPerPixel;
    const s = Math.sin(rotationRad) * metersPerPixel;
    return [c, s, -s, c, originX, originZ];
}

export function decomposeMatrix(m: NonNullable<SourceReference['pixelToWorldXZ']>): { metersPerPixel: number; rotationRad: number; originX: number; originZ: number } {
    return { metersPerPixel: Math.hypot(m[0], m[1]), rotationRad: Math.atan2(m[1], m[0]), originX: m[4], originZ: m[5] };
}

export function effectiveMatrix(source: SourceReference): NonNullable<SourceReference['pixelToWorldXZ']> {
    return source.pixelToWorldXZ ?? similarityMatrix(DEFAULT_METERS_PER_PIXEL, 0, 0, 0);
}

interface Props {
    hasImage: boolean;
    visible: boolean;
    opacity: number;
    onVisible(v: boolean): void;
    onOpacity(v: number): void;
    onLoadImage(file: File): void;
}

export function SourcePanel({ hasImage, visible, opacity, onVisible, onOpacity, onLoadImage }: Props) {
    const { run } = useEditor();
    const { scene } = useStoreState();
    const source = scene.sources[0];
    const m = source ? decomposeMatrix(effectiveMatrix(source)) : null;

    const align = (patch: Partial<NonNullable<typeof m>>) => {
        if (!source || !m) return;
        const n = { ...m, ...patch };
        run({
            type: 'setSource',
            source: {
                ...source,
                pixelToWorldXZ: similarityMatrix(n.metersPerPixel, n.rotationRad, n.originX, n.originZ),
                calibrationMethod: 'manual',
            },
        });
    };

    return (
        <section className="panel">
            <h2>Source image</h2>
            <label className="file-button">
                {source?.imageKey ? 'Replace reference image…' : 'Load reference image…'}
                <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) onLoadImage(f);
                        e.target.value = '';
                    }}
                />
            </label>
            {source && !hasImage && source.imageKey && <p className="muted small">The image for this project isn’t stored in this browser (portable JSON doesn’t include images). Load it again to show the overlay.</p>}
            {source && hasImage && m && (
                <>
                    <p className="muted small">
                        {source.name} · {source.pixelToWorldXZ ? `calibrated (${source.calibrationMethod ?? 'unspecified'})` : 'uncalibrated reference'}
                    </p>
                    <label className="check">
                        <input type="checkbox" checked={visible} onChange={(e) => onVisible(e.target.checked)} /> Show overlay
                    </label>
                    <label className="field">
                        <span className="field-label">Opacity</span>
                        <input type="range" min={0.05} max={1} step={0.05} value={opacity} onChange={(e) => onOpacity(Number(e.target.value))} />
                    </label>
                    <div className="field-row">
                        <NumberField label="Scale" unit="m/px" step={0.001} digits={5} min={0.00001} value={m.metersPerPixel} onCommit={(v) => align({ metersPerPixel: v })} />
                        <NumberField label="Rotate" unit="°" step={1} digits={2} value={(m.rotationRad * 180) / Math.PI} onCommit={(v) => align({ rotationRad: (v * Math.PI) / 180 })} />
                    </div>
                    <div className="field-row">
                        <NumberField label="Offset X" unit="m" value={m.originX} onCommit={(v) => align({ originX: v })} />
                        <NumberField label="Offset Z" unit="m" value={m.originZ} onCommit={(v) => align({ originZ: v })} />
                    </div>
                    {source.calibrationMethod && source.calibrationMethod !== 'manual' && <p className="muted small">Editing alignment replaces the {source.calibrationMethod} calibration with a manual one.</p>}
                </>
            )}
        </section>
    );
}
