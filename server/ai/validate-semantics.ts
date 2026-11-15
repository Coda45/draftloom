import { ApiError } from '../api/errors';
import type { LegendEntry, NormalizedBox, SketchSemantics } from './types';

type Obj = Record<string, unknown>;

function object(value: unknown): value is Obj {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function normalizedBox(value: unknown): NormalizedBox | undefined {
    if (value === undefined) return undefined;
    if (!object(value) || !finite(value.x) || !finite(value.y) || !finite(value.width) || !finite(value.height)) {
        throw new ApiError(502, 'AI_RESPONSE_INVALID', 'The AI returned an invalid legend area.', true);
    }
    if (value.x < 0 || value.y < 0 || value.width <= 0 || value.height <= 0 || value.x + value.width > 1.001 || value.y + value.height > 1.001) {
        throw new ApiError(502, 'AI_RESPONSE_INVALID', 'The AI legend area was outside the image.', true);
    }
    return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function legendEntry(value: unknown, index: number): LegendEntry {
    if (!object(value) || typeof value.label !== 'string' || !value.label.trim() || typeof value.colorHex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.colorHex)) {
        throw new ApiError(502, 'AI_RESPONSE_INVALID', `The AI returned an invalid legend entry at index ${index}.`, true);
    }
    if (value.defaultHeightM !== undefined && (!finite(value.defaultHeightM) || value.defaultHeightM <= 0 || value.defaultHeightM > 100)) {
        throw new ApiError(502, 'AI_RESPONSE_INVALID', `The AI returned an invalid height for legend entry ${index}.`, true);
    }
    return {
        label: value.label.trim().slice(0, 100),
        colorHex: value.colorHex.toUpperCase(),
        ...(finite(value.defaultHeightM) ? { defaultHeightM: value.defaultHeightM } : {}),
    };
}

export function validateSketchSemantics(value: unknown): SketchSemantics {
    if (!object(value) || (value.mode !== 'floorplan' && value.mode !== 'isometric') || !Array.isArray(value.legendEntries)) {
        throw new ApiError(502, 'AI_RESPONSE_INVALID', 'The AI response did not match the sketch-semantics contract.', true);
    }
    const legendEntries = value.legendEntries.map(legendEntry);
    if (legendEntries.length > 32) throw new ApiError(502, 'AI_RESPONSE_INVALID', 'The AI returned too many legend entries.', true);
    if (value.metersPerPixel !== undefined && (!finite(value.metersPerPixel) || value.metersPerPixel <= 0 || value.metersPerPixel > 10)) {
        throw new ApiError(502, 'AI_RESPONSE_INVALID', 'The AI returned an invalid image scale.', true);
    }
    if (value.wallHeightM !== undefined && (!finite(value.wallHeightM) || value.wallHeightM <= 0 || value.wallHeightM > 100)) {
        throw new ApiError(502, 'AI_RESPONSE_INVALID', 'The AI returned an invalid wall height.', true);
    }
    const notes = Array.isArray(value.notes) ? value.notes.filter((note): note is string => typeof note === 'string').slice(0, 20).map((note) => note.slice(0, 300)) : [];
    return {
        mode: value.mode,
        legendEntries,
        legendArea: normalizedBox(value.legendArea),
        ...(finite(value.metersPerPixel) ? { metersPerPixel: value.metersPerPixel } : {}),
        ...(finite(value.wallHeightM) ? { wallHeightM: value.wallHeightM } : {}),
        notes,
    };
}
