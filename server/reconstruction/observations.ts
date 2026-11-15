import { ApiError } from '../api/errors';
import type { ImageObservations } from '../../src/import/preprocess/types';

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function parseObservations(raw: unknown): ImageObservations {
    let value: unknown = raw;
    if (typeof raw === 'string') {
        try { value = JSON.parse(raw); } catch { throw new ApiError(400, 'OBSERVATIONS_INVALID', 'Image observations were not valid JSON.'); }
    }
    if (!value || typeof value !== 'object') throw new ApiError(400, 'OBSERVATIONS_REQUIRED', 'Deterministic image observations are required.');
    const input = value as Record<string, unknown>;
    if (input.version !== 1 || !finite(input.widthPx) || !finite(input.heightPx) || input.widthPx <= 0 || input.heightPx <= 0 || !Array.isArray(input.wallSegments) || !Array.isArray(input.colorComponents)) {
        throw new ApiError(400, 'OBSERVATIONS_INVALID', 'Image observations do not match version 1.');
    }
    if (input.wallSegments.length > 500 || input.colorComponents.length > 1000) throw new ApiError(413, 'OBSERVATIONS_TOO_LARGE', 'Image observations contain too many features.');
    const wallSegments = input.wallSegments.map((item, index) => {
        const segment = item as Record<string, unknown>;
        if (!segment || !Array.isArray(segment.start) || !Array.isArray(segment.end) || segment.start.length !== 2 || segment.end.length !== 2 || !segment.start.every(finite) || !segment.end.every(finite) || !finite(segment.confidence)) throw new ApiError(400, 'OBSERVATIONS_INVALID', `Wall observation ${index} is invalid.`);
        return { id: String(segment.id || `wall-${index + 1}`).slice(0, 100), start: [segment.start[0], segment.start[1]] as [number, number], end: [segment.end[0], segment.end[1]] as [number, number], confidence: Math.min(1, Math.max(0, segment.confidence)) };
    });
    const colorComponents = input.colorComponents.map((item, index) => {
        const component = item as Record<string, unknown>; const bounds = component?.bounds as Record<string, unknown>;
        if (!component || !bounds || !finite(bounds.x) || !finite(bounds.y) || !finite(bounds.width) || !finite(bounds.height) || bounds.width <= 0 || bounds.height <= 0 || typeof component.colorHex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(component.colorHex) || !finite(component.pixelCount) || !finite(component.confidence)) throw new ApiError(400, 'OBSERVATIONS_INVALID', `Color observation ${index} is invalid.`);
        return { id: String(component.id || `color-${index + 1}`).slice(0, 100), bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, colorHex: component.colorHex.toUpperCase(), pixelCount: component.pixelCount, confidence: Math.min(1, Math.max(0, component.confidence)) };
    });
    return { version: 1, widthPx: input.widthPx, heightPx: input.heightPx, wallSegments, colorComponents };
}

export interface CalibrationInput { metersPerPixel?: number; originX?: number; originZ?: number; wallHeightM?: number }

export function parseCalibration(raw: unknown): CalibrationInput | undefined {
    if (raw === undefined || raw === '') return undefined;
    let value: unknown = raw;
    if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch { throw new ApiError(400, 'CALIBRATION_INVALID', 'Calibration was not valid JSON.'); } }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'CALIBRATION_INVALID', 'Calibration must be an object.');
    const input = value as Record<string, unknown>; const result: CalibrationInput = {};
    for (const key of ['metersPerPixel', 'originX', 'originZ', 'wallHeightM'] as const) if (input[key] !== undefined) {
        if (!finite(input[key])) throw new ApiError(400, 'CALIBRATION_INVALID', `${key} must be finite.`);
        result[key] = input[key];
    }
    if (result.metersPerPixel !== undefined && (result.metersPerPixel <= 0 || result.metersPerPixel > 10)) throw new ApiError(400, 'CALIBRATION_INVALID', 'metersPerPixel is outside the supported range.');
    if (result.wallHeightM !== undefined && (result.wallHeightM <= 0 || result.wallHeightM > 100)) throw new ApiError(400, 'CALIBRATION_INVALID', 'wallHeightM is outside the supported range.');
    return result;
}
