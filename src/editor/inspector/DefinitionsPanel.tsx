// Object definitions: shared name, color, and default size for linked instances.
import { useEditor, useStoreState } from '../../app/EditorContext';
import { newId } from '../../scene/ids';
import type { Dimensions } from '../../scene/schema';
import { ColorField, NumberField, TextField } from './fields';

const PALETTE = ['#4f7cac', '#c9733a', '#6aa84f', '#a64d79', '#d4b13f', '#5b9aa0', '#8e7cc3', '#cc4125'];

interface Props {
    activeDefinitionId: string | null;
    onActivate(id: string): void;
}

export function DefinitionsPanel({ activeDefinitionId, onActivate }: Props) {
    const { run } = useEditor();
    const { scene } = useStoreState();
    const definitions = Object.values(scene.definitions);
    const active = (activeDefinitionId && scene.definitions[activeDefinitionId]) || null;

    const create = () => {
        const id = newId('def');
        const n = definitions.length + 1;
        if (run({ type: 'addDefinition', definition: { id, name: `Object ${n}`, color: PALETTE[(n - 1) % PALETTE.length], dimensions: [1, 1, 1] } })) {
            onActivate(id);
        }
    };

    return (
        <section className="panel">
            <h2>
                Definitions
                <button className="small-button" onClick={create}>
                    + New
                </button>
            </h2>
            {definitions.length === 0 && <p className="muted">No definitions yet. Create one to place boxes.</p>}
            <ul className="def-list">
                {definitions.map((d) => {
                    const count = scene.objects.filter((o) => o.kind === 'box' && o.definitionId === d.id).length;
                    return (
                        <li key={d.id}>
                            <button className={`def-item ${d.id === activeDefinitionId ? 'on' : ''}`} onClick={() => onActivate(d.id)}>
                                <span className="swatch" style={{ background: d.color }} />
                                <span className="def-name">{d.name}</span>
                                <span className="muted small">
                                    {d.dimensions.map((v) => v.toFixed(2)).join(' × ')} m · {count}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
            {active && (
                <div className="def-editor">
                    <div className="field-row">
                        <TextField label="Name" value={active.name} onCommit={(name) => run({ type: 'editDefinition', id: active.id, patch: { name } })} />
                        <ColorField label="Color" value={active.color} onCommit={(color) => run({ type: 'editDefinition', id: active.id, patch: { color } })} />
                    </div>
                    <div className="field-row">
                        {(['W', 'H', 'D'] as const).map((label, axis) => (
                            <NumberField
                                key={label}
                                label={label}
                                unit="m"
                                min={0.01}
                                value={active.dimensions[axis]}
                                onCommit={(v) => {
                                    const next = [...active.dimensions] as Dimensions;
                                    next[axis] = v;
                                    run({ type: 'editDefinition', id: active.id, patch: { dimensions: next } });
                                }}
                            />
                        ))}
                    </div>
                    <button className="link-button danger-text" onClick={() => run({ type: 'deleteDefinition', id: active.id })}>
                        Delete definition
                    </button>
                </div>
            )}
        </section>
    );
}
