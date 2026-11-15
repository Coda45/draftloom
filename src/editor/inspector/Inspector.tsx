// Property inspector for the selected object. Box dimension edits can target
// the selected instance (override) or every instance of its definition.
import { useState } from 'react';
import { useEditor, useStoreState } from '../../app/EditorContext';
import { boxDimensions, polygonArea, wallLength } from '../../scene/geometry';
import type { BoxInstance, Dimensions, GeometryProvenance, Region, SceneDocument, WallSegment } from '../../scene/schema';
import { customObjectName } from '../viewport3d/sceneObjects';
import { NumberField, TextField } from './fields';

const DEG = 180 / Math.PI;

export function Inspector() {
    const { scene, selectedId } = useStoreState();
    const selected = scene.objects.find((o) => o.id === selectedId);
    if (!selected) {
        return (
            <section className="panel">
                <h2>Inspector</h2>
                <p className="muted">Select an object in the 2D or 3D view.</p>
            </section>
        );
    }
    return (
        <section className="panel">
            <h2>
                Inspector <span className="kind-tag">{selected.kind}</span>
            </h2>
            {selected.kind === 'box' && <BoxInspector box={selected} scene={scene} />}
            {selected.kind === 'wall' && <WallInspector wall={selected} />}
            {selected.kind === 'region' && <RegionInspector region={selected} />}
            <ProvenanceInfo id={selected.id} provenance={selected.provenance} />
        </section>
    );
}

function BoxInspector({ box, scene }: { box: BoxInstance; scene: SceneDocument }) {
    const { run } = useEditor();
    const [scope, setScope] = useState<'instance' | 'definition'>('instance');
    const definitions = Object.values(scene.definitions);
    const def = scene.definitions[box.definitionId];
    const dims = boxDimensions(box, scene.definitions);
    const linked = scene.objects.filter((o) => o.kind === 'box' && o.definitionId === box.definitionId && !o.dimensionsOverride).length;

    const setDim = (axis: 0 | 1 | 2, v: number) => {
        if (scope === 'definition' && def) {
            const next = [...def.dimensions] as Dimensions;
            next[axis] = v;
            run({ type: 'editDefinition', id: def.id, patch: { dimensions: next } });
        } else {
            const next = [...dims] as Dimensions;
            next[axis] = v;
            run({ type: 'setInstanceDimensionsOverride', id: box.id, dimensions: next });
        }
    };
    const shown = scope === 'definition' && def ? def.dimensions : dims;

    return (
        <>
            <TextField label="Name" value={customObjectName(box) ?? ''} placeholder={def?.name} onCommit={(name) => run({ type: 'renameObject', id: box.id, name })} />
            <label className="field">
                <span className="field-label">Definition</span>
                <select value={box.definitionId} onChange={(e) => run({ type: 'setBoxDefinition', id: box.id, definitionId: e.target.value })}>
                    {definitions.map((d) => (
                        <option key={d.id} value={d.id}>
                            {d.name}
                        </option>
                    ))}
                </select>
            </label>
            <div className="field-row">
                <NumberField label="X" unit="m" value={box.position[0]} onCommit={(x) => run({ type: 'moveBox', id: box.id, position: [x, box.position[1], box.position[2]] })} />
                <NumberField label="Z" unit="m" value={box.position[2]} onCommit={(z) => run({ type: 'moveBox', id: box.id, position: [box.position[0], box.position[1], z] })} />
                <NumberField label="Base Y" unit="m" value={box.position[1]} onCommit={(y) => run({ type: 'moveBox', id: box.id, position: [box.position[0], y, box.position[2]] })} />
            </div>
            <NumberField label="Yaw" unit="°" step={15} digits={2} value={box.rotationY * DEG} onCommit={(deg) => run({ type: 'setBoxRotation', id: box.id, rotationY: deg / DEG })} />

            <div className="scope-toggle" role="radiogroup" aria-label="Dimension edit scope">
                <button className={scope === 'instance' ? 'on' : ''} onClick={() => setScope('instance')}>
                    This instance
                </button>
                <button className={scope === 'definition' ? 'on' : ''} onClick={() => setScope('definition')} disabled={!def}>
                    All “{def?.name ?? '?'}”
                </button>
            </div>
            <div className="field-row">
                <NumberField label="Width X" unit="m" min={0.01} value={shown[0]} onCommit={(v) => setDim(0, v)} />
                <NumberField label="Height Y" unit="m" min={0.01} value={shown[1]} onCommit={(v) => setDim(1, v)} />
                <NumberField label="Depth Z" unit="m" min={0.01} value={shown[2]} onCommit={(v) => setDim(2, v)} />
            </div>
            <p className="muted small">
                {scope === 'definition'
                    ? `Changes the default size for ${linked} linked instance${linked === 1 ? '' : 's'}; overridden instances keep their own size.`
                    : box.dimensionsOverride
                      ? 'This instance overrides its definition size.'
                      : 'Editing creates a size override for this instance only.'}
            </p>
            {box.dimensionsOverride && (
                <button className="link-button" onClick={() => run({ type: 'clearInstanceDimensionsOverride', id: box.id })}>
                    Reset to definition size
                </button>
            )}
            <IdLine id={box.id} extra={`definition ${box.definitionId}`} />
            <DeleteButton id={box.id} />
        </>
    );
}

function WallInspector({ wall }: { wall: WallSegment }) {
    const { run } = useEditor();
    return (
        <>
            <TextField label="Name" value={customObjectName(wall) ?? ''} placeholder="Wall" onCommit={(name) => run({ type: 'renameObject', id: wall.id, name })} />
            <div className="field-row">
                <NumberField label="Start X" unit="m" value={wall.start[0]} onCommit={(v) => run({ type: 'moveWallEndpoint', id: wall.id, endpoint: 'start', point: [v, wall.start[1]] })} />
                <NumberField label="Start Z" unit="m" value={wall.start[1]} onCommit={(v) => run({ type: 'moveWallEndpoint', id: wall.id, endpoint: 'start', point: [wall.start[0], v] })} />
            </div>
            <div className="field-row">
                <NumberField label="End X" unit="m" value={wall.end[0]} onCommit={(v) => run({ type: 'moveWallEndpoint', id: wall.id, endpoint: 'end', point: [v, wall.end[1]] })} />
                <NumberField label="End Z" unit="m" value={wall.end[1]} onCommit={(v) => run({ type: 'moveWallEndpoint', id: wall.id, endpoint: 'end', point: [wall.end[0], v] })} />
            </div>
            <div className="field-row">
                <NumberField label="Base Y" unit="m" value={wall.baseY} onCommit={(v) => run({ type: 'setWallBaseY', id: wall.id, baseY: v })} />
                <NumberField label="Height" unit="m" min={0.01} value={wall.height} onCommit={(v) => run({ type: 'setWallHeight', id: wall.id, height: v })} />
                <NumberField label="Thickness" unit="m" min={0.005} step={0.01} value={wall.thickness} onCommit={(v) => run({ type: 'setWallThickness', id: wall.id, thickness: v })} />
            </div>
            <p className="readout">Length {wallLength(wall).toFixed(3)} m</p>
            <IdLine id={wall.id} />
            <DeleteButton id={wall.id} />
        </>
    );
}

function RegionInspector({ region }: { region: Region }) {
    const { run } = useEditor();
    return (
        <>
            <TextField label="Name" value={region.name} onCommit={(name) => run({ type: 'renameRegion', id: region.id, name })} />
            <p className="readout">
                Area {polygonArea(region.polygon).toFixed(2)} m² · {region.polygon.length} vertices
            </p>
            <p className="muted small">Drag the square handles in the 2D view to edit vertices.</p>
            <IdLine id={region.id} />
            <DeleteButton id={region.id} />
        </>
    );
}

function ProvenanceInfo({ provenance }: { id: string; provenance?: GeometryProvenance }) {
    if (!provenance) return null;
    return (
        <div className="provenance">
            <span>Source: {provenance.method}</span>
            {provenance.confidence !== undefined && <span>Confidence {(provenance.confidence * 100).toFixed(0)}%</span>}
            {provenance.method === 'inferred' && <span className="warn">Inferred geometry — please verify</span>}
            {provenance.notes?.filter((note) => !note.startsWith('displayName:')).map((note) => <span key={note}>{note}</span>)}
        </div>
    );
}

function IdLine({ id, extra }: { id: string; extra?: string }) {
    return (
        <p className="id-line" title={id}>
            id {id}
            {extra ? ` · ${extra}` : ''}
        </p>
    );
}

function DeleteButton({ id }: { id: string }) {
    const { run } = useEditor();
    return (
        <button className="danger" onClick={() => run({ type: 'deleteObject', id })}>
            Delete
        </button>
    );
}
