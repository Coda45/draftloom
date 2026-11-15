// Small form controls that commit on Enter/blur, so typing never floods history.
import { useEffect, useRef, useState } from 'react';

interface NumberFieldProps {
    label: string;
    value: number;
    onCommit(value: number): void;
    unit?: string;
    min?: number;
    step?: number;
    digits?: number;
    disabled?: boolean;
}

export function NumberField({ label, value, onCommit, unit, min, step = 0.05, digits = 3, disabled }: NumberFieldProps) {
    const format = (v: number) => String(Number(v.toFixed(digits)));
    const [text, setText] = useState(format(value));
    useEffect(() => setText(format(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps

    const commit = () => {
        const n = Number(text);
        if (text.trim() === '' || !Number.isFinite(n) || (min !== undefined && n < min)) {
            setText(format(value));
            return;
        }
        if (Math.abs(n - value) > 1e-12) onCommit(n);
    };

    return (
        <label className="field">
            <span className="field-label">{label}</span>
            <span className="field-input">
                <input
                    type="number"
                    value={text}
                    step={step}
                    min={min}
                    disabled={disabled}
                    onChange={(e) => setText(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') {
                            setText(format(value));
                            (e.target as HTMLInputElement).blur();
                        }
                    }}
                />
                {unit && <span className="unit">{unit}</span>}
            </span>
        </label>
    );
}

/** Color picker that commits once when the native picker closes, not on every drag tick. */
export function ColorField({ label, value, onCommit }: { label: string; value: string; onCommit(value: string): void }) {
    const ref = useRef<HTMLInputElement>(null);
    const commitRef = useRef(onCommit);
    commitRef.current = onCommit;
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.value = value;
        // The native 'change' event fires when the picker is dismissed.
        const onChange = () => commitRef.current(el.value);
        el.addEventListener('change', onChange);
        return () => el.removeEventListener('change', onChange);
    }, [value]);
    return (
        <label className="field color-field">
            <span className="field-label">{label}</span>
            <input ref={ref} type="color" defaultValue={value} />
        </label>
    );
}

interface TextFieldProps {
    label: string;
    value: string;
    onCommit(value: string): void;
    placeholder?: string;
}

export function TextField({ label, value, onCommit, placeholder }: TextFieldProps) {
    const [text, setText] = useState(value);
    useEffect(() => setText(value), [value]);
    return (
        <label className="field">
            <span className="field-label">{label}</span>
            <input
                type="text"
                value={text}
                placeholder={placeholder}
                onChange={(e) => setText(e.target.value)}
                onBlur={() => text !== value && onCommit(text)}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
        </label>
    );
}
