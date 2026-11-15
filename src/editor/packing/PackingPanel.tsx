// "Maximize Space" UI: arrange instances of a definition inside a region.
import { useState } from 'react';
import { useEditor, useStoreState } from '../../app/EditorContext';
import type { Region } from '../../scene/schema';
import { NumberField } from '../inspector/fields';
import { packRegion } from './packRegion';

export function PackingPanel({ activeDefinitionId }: { activeDefinitionId: string | null }) {
    const { store, run } = useEditor();
    const { scene, selectedId } = useStoreState();
    const regions = scene.objects.filter((o): o is Region => o.kind === 'region');
    const [regionChoice, setRegionChoice] = useState<string>('');
    const [defChoice, setDefChoice] = useState<string>('');
    const [gap, setGap] = useState(0.5);
    const [margin, setMargin] = useState(0);
    const [allowRotate, setAllowRotate] = useState(true);
    const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);

    // Default to the selected region and the active definition.
    const selectedRegion = regions.find((r) => r.id === selectedId);
    const regionId = regions.some((r) => r.id === regionChoice) ? regionChoice : (selectedRegion?.id ?? regions[0]?.id ?? '');
    const definitionId = scene.definitions.some((d) => d.id === defChoice) ? defChoice : (activeDefinitionId ?? scene.definitions[0]?.id ?? '');

    const arrange = () => {
        const r = packRegion(store.getScene(), {
            regionId,
            definitionId,
            gapM: gap,
            boundaryMarginM: margin,
            orientations: allowRotate ? [0, Math.PI / 2] : [0],
        });
        if (r.boxes.length === 0) {
            setResult({ text: r.diagnostics.join(' '), ok: false });
            return;
        }
        if (run({ type: 'applyPackingResult', boxes: r.boxes })) {
            const rot = r.yaw && Math.abs(r.yaw) > 1e-6 ? ' (rotated 90°)' : '';
            setResult({ text: `Placed ${r.boxes.length} objects${rot}. ${r.diagnostics.join(' ')}`.trim(), ok: true });
        }
    };

    return (
        <section className="panel">
            <h2>Maximize Space</h2>
            {regions.length === 0 ? (
                <p className="muted">Draw a region first (Region tool).</p>
            ) : (
                <>
                    <label className="field">
                        <span className="field-label">Region</span>
                        <select value={regionId} onChange={(e) => setRegionChoice(e.target.value)}>
                            {regions.map((r) => (
                                <option key={r.id} value={r.id}>
                                    {r.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="field">
                        <span className="field-label">Object</span>
                        <select value={definitionId} onChange={(e) => setDefChoice(e.target.value)}>
                            {scene.definitions.map((d) => (
                                <option key={d.id} value={d.id}>
                                    {d.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <div className="field-row">
                        <NumberField label="Gap" unit="m" min={0} value={gap} onCommit={setGap} />
                        <NumberField label="Edge margin" unit="m" min={0} value={margin} onCommit={setMargin} />
                    </div>
                    <label className="check">
                        <input type="checkbox" checked={allowRotate} onChange={(e) => setAllowRotate(e.target.checked)} /> Allow 90° rotation
                    </label>
                    <button className="primary" onClick={arrange} disabled={!regionId || !definitionId}>
                        Arrange / Maximize Count
                    </button>
                    {result && <p className={result.ok ? 'result ok' : 'result err'}>{result.text}</p>}
                    <p className="muted small">Grid search over offsets and orientations; keeps the gap from walls, existing boxes, and each other. Best found, not guaranteed optimal. Undo reverts the whole arrangement.</p>
                </>
            )}
        </section>
    );
}
