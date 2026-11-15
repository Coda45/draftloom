import { randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS, type BoxInstance, type ObjectDefinition, type SceneDocument, type WallSegment } from '../../../src/scene/schema';
import { validateScene } from '../../../src/scene/validate';
import { RECONSTRUCTION_CONTRACT_VERSION, type ReconstructionIssue, type ReconstructionResult } from '../../../src/shared/reconstruction-contract';
import type { ImageObservations, ColorComponent } from '../../../src/import/preprocess/types';
import type { ValidatedImage } from '../../api/image';
import { ApiError } from '../../api/errors';
import type { SketchSemantics, LegendEntry } from '../../ai/types';
import type { CalibrationInput } from '../observations';

function rgb(color: string): [number, number, number] { return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)]; }
function distance(a: string, b: string): number { const x = rgb(a); const y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); }
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'object'; }
function insideLegend(component: ColorComponent, semantics: SketchSemantics | undefined, width: number, height: number): boolean {
    if (!semantics?.legendArea) return false;
    const centerX = (component.bounds.x + component.bounds.width / 2) / width; const centerY = (component.bounds.y + component.bounds.height / 2) / height;
    const area = semantics.legendArea; return centerX >= area.x && centerX <= area.x + area.width && centerY >= area.y && centerY <= area.y + area.height;
}

function wallOutsideLegend(segment: ImageObservations['wallSegments'][number], semantics: SketchSemantics | undefined, width: number, height: number): boolean {
    if (!semantics?.legendArea) return true;
    const x = (segment.start[0] + segment.end[0]) / 2 / width; const y = (segment.start[1] + segment.end[1]) / 2 / height; const area = semantics.legendArea;
    return x < area.x || x > area.x + area.width || y < area.y || y > area.y + area.height;
}

export function reconstructFloorplan(input: { image: ValidatedImage; observations: ImageObservations; semantics?: SketchSemantics; calibration?: CalibrationInput }): ReconstructionResult {
    const { image, observations, semantics, calibration } = input;
    const detectedScale = calibration?.metersPerPixel ?? semantics?.metersPerPixel;
    const scale = detectedScale ?? 0.01; const originX = calibration?.originX ?? 0; const originZ = calibration?.originZ ?? 0;
    const sourceId = `source-${randomUUID()}`; const issues: ReconstructionIssue[] = [];
    if (!detectedScale) issues.push({ id: 'missing-scale', severity: 'warning', code: 'SCALE_CONFIRMATION_REQUIRED', message: 'No reliable drawing scale was found. A provisional scale was used; confirm it before relying on measurements.' });
    if (!semantics) issues.push({ id: 'ai-unavailable', severity: 'warning', code: 'AI_SEMANTICS_UNAVAILABLE', message: 'Semantic AI was not configured. Colored objects use generic names and remain editable.' });
    for (const [index, note] of (semantics?.notes ?? []).entries()) issues.push({ id: `ai-note-${index + 1}`, severity: 'info', code: 'INTERPRETATION_NOTE', message: note });
    const wallHeight = calibration?.wallHeightM ?? semantics?.wallHeightM ?? 2.7;
    if (calibration?.wallHeightM === undefined && semantics?.wallHeightM === undefined && observations.wallSegments.length) issues.push({ id: 'wall-height-inferred', severity: 'info', code: 'WALL_HEIGHT_INFERRED', message: 'Wall footprint lines were measured, but wall height uses an editable inferred default.' });
    const walls: WallSegment[] = observations.wallSegments.filter((segment) => wallOutsideLegend(segment, semantics, observations.widthPx, observations.heightPx) && Math.hypot(segment.end[0] - segment.start[0], segment.end[1] - segment.start[1]) * scale >= 0.1).map((segment, index) => ({
        id: `wall-${index + 1}-${randomUUID()}`, kind: 'wall', name: `Wall ${index + 1}`,
        start: [originX + segment.start[0] * scale, originZ + segment.start[1] * scale], end: [originX + segment.end[0] * scale, originZ + segment.end[1] * scale],
        baseY: 0, height: wallHeight, thickness: Math.max(0.08, Math.min(0.3, scale * 5)), provenance: { sourceId, method: calibration?.wallHeightM !== undefined || semantics?.wallHeightM !== undefined ? 'detected' : 'inferred', confidence: segment.confidence },
    }));
    const usable = observations.colorComponents.filter((component) => !insideLegend(component, semantics, observations.widthPx, observations.heightPx));
    const legend: LegendEntry[] = semantics?.legendEntries.length ? semantics.legendEntries : [...new Set(usable.map((component) => component.colorHex))].map((colorHex, index) => ({ label: `Detected object ${index + 1}`, colorHex }));
    const definitions: Record<string, ObjectDefinition> = {}; const definitionByLegend = new Map<LegendEntry, string>();
    for (const entry of legend) { const id = `definition-${slug(entry.label)}-${randomUUID()}`; definitions[id] = { id, name: entry.label, dimensions: [1, entry.defaultHeightM ?? 0.8, 1], color: entry.colorHex }; definitionByLegend.set(entry, id); }
    const boxes: BoxInstance[] = [];
    for (const component of usable) {
        const ranked = legend.map((entry) => ({ entry, distance: distance(component.colorHex, entry.colorHex) })).sort((a, b) => a.distance - b.distance); const match = ranked[0]?.entry;
        if (!match || ranked[0].distance > 110) { issues.push({ id: `unmatched-${component.id}`, severity: 'warning', code: 'COLOR_UNMATCHED', message: `A colored shape (${component.colorHex}) did not match the interpreted legend.` }); continue; }
        if (ranked[1] && ranked[1].distance - ranked[0].distance < 15) { issues.push({ id: `ambiguous-${component.id}`, severity: 'warning', code: 'COLOR_AMBIGUOUS', message: `A colored shape (${component.colorHex}) is equally close to ${ranked[0].entry.label} and ${ranked[1].entry.label}; choose its category manually.` }); continue; }
        const definitionId = definitionByLegend.get(match)!; const width = Math.max(0.05, component.bounds.width * scale); const depth = Math.max(0.05, component.bounds.height * scale); const height = match.defaultHeightM ?? 0.8;
        boxes.push({ id: `box-${randomUUID()}`, kind: 'box', definitionId, name: match.label, position: [originX + (component.bounds.x + component.bounds.width / 2) * scale, 0, originZ + (component.bounds.y + component.bounds.height / 2) * scale], rotationY: 0, dimensionsOverride: [width, height, depth], provenance: { sourceId, method: match.defaultHeightM === undefined ? 'inferred' : 'detected', confidence: component.confidence, notes: [`Matched color ${component.colorHex} to ${match.colorHex}.`, ...(match.defaultHeightM === undefined ? ['Height uses an editable inferred default.'] : [])] } });
    }
    for (const object of [...walls, ...boxes]) if ((object.provenance?.confidence ?? 1) < 0.6) issues.push({ id: `low-confidence-${object.id}`, severity: 'warning', code: 'GEOMETRY_LOW_CONFIDENCE', message: `${object.name ?? 'Detected geometry'} should be checked against the source image.`, objectId: object.id });
    if (!walls.length && !boxes.length) throw new ApiError(422, 'RECONSTRUCTION_EMPTY', 'No reliable walls or colored objects were detected. Improve lighting and use stronger line or fill contrast.');
    const now = new Date().toISOString();
    const scene: SceneDocument = { schemaVersion: 1, id: `scene-${randomUUID()}`, name: image.name.replace(/\.[^.]+$/, '') || 'Imported sketch', units: 'm', upAxis: 'Y', definitions, objects: [...walls, ...boxes], sources: [{ id: sourceId, name: image.name, mode: 'floorplan', mimeType: image.mimeType, widthPx: observations.widthPx, heightPx: observations.heightPx, pixelToWorldXZ: [scale, 0, 0, scale, originX, originZ], calibrationMethod: calibration?.metersPerPixel ? 'manual' : semantics?.metersPerPixel ? 'detected' : 'inferred', notes: ['Source image retained by the import workflow as an alignment overlay.'] }], settings: { ...DEFAULT_SETTINGS }, createdAt: now, updatedAt: now };
    const validation = validateScene(scene);
    if (!validation.ok) throw new ApiError(500, 'SCENE_VALIDATION_FAILED', `Reconstruction created an invalid scene: ${validation.errors.slice(0, 3).join('; ')}`);
    return { contractVersion: RECONSTRUCTION_CONTRACT_VERSION, modeUsed: 'floorplan', scene: validation.scene, issues, requiresScaleConfirmation: !detectedScale };
}
