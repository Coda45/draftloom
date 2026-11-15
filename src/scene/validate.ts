// Structural and semantic validation for untrusted SceneDocument input
// (files, IndexedDB, reconstruction results).
import { polygonProblem } from './geometry';
import {
    MAX_DEFINITIONS,
    MAX_POLYGON_VERTICES,
    MAX_SCENE_OBJECTS,
    SCENE_SCHEMA_VERSION,
    type SceneDocument,
} from './schema';

export type ValidationResult = { ok: true; scene: SceneDocument } | { ok: false; errors: string[] };

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_ERRORS = 50;

type Obj = Record<string, unknown>;

function isObject(v: unknown): v is Obj {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
    return typeof v === 'string' && v.length > 0;
}

class Collector {
    errors: string[] = [];

    add(path: string, message: string): void {
        if (this.errors.length < MAX_ERRORS) this.errors.push(`${path}: ${message}`);
    }

    finiteTuple(path: string, v: unknown, length: number, positive = false): boolean {
        if (!Array.isArray(v) || v.length !== length) {
            this.add(path, `expected an array of ${length} numbers`);
            return false;
        }
        let ok = true;
        v.forEach((n, i) => {
            if (!isFiniteNumber(n)) {
                this.add(`${path}[${i}]`, 'must be a finite number (NaN and Infinity are not allowed)');
                ok = false;
            } else if (positive && n <= 0) {
                this.add(`${path}[${i}]`, 'must be greater than zero');
                ok = false;
            }
        });
        return ok;
    }

    positive(path: string, v: unknown): void {
        if (!isFiniteNumber(v)) this.add(path, 'must be a finite number');
        else if (v <= 0) this.add(path, 'must be greater than zero');
    }

    color(path: string, v: unknown, optional: boolean): void {
        if (v === undefined && optional) return;
        if (typeof v !== 'string' || !COLOR_RE.test(v)) this.add(path, `expected a #rrggbb color, got ${JSON.stringify(v)}`);
    }

    optionalString(path: string, v: unknown): void {
        if (v !== undefined && typeof v !== 'string') this.add(path, 'must be a string when present');
    }

    provenance(path: string, v: unknown): void {
        if (v === undefined) return;
        if (!isObject(v)) {
            this.add(path, 'must be an object');
            return;
        }
        if (!['manual', 'reconstructed', 'packing', 'imported'].includes(v.origin as string)) {
            this.add(`${path}.origin`, 'must be manual, reconstructed, packing, or imported');
        }
        if (v.confidence !== undefined && (!isFiniteNumber(v.confidence) || v.confidence < 0 || v.confidence > 1)) {
            this.add(`${path}.confidence`, 'must be a number between 0 and 1');
        }
        if (v.inferred !== undefined && typeof v.inferred !== 'boolean') this.add(`${path}.inferred`, 'must be a boolean');
        if (v.sourcePolygonPx !== undefined) {
            if (!Array.isArray(v.sourcePolygonPx)) this.add(`${path}.sourcePolygonPx`, 'must be an array of [u, v] points');
            else v.sourcePolygonPx.forEach((p, i) => this.finiteTuple(`${path}.sourcePolygonPx[${i}]`, p, 2));
        }
        this.optionalString(`${path}.note`, v.note);
    }
}

/** Validates unknown input as a SceneDocument; returns readable, path-prefixed errors. */
export function validateScene(input: unknown): ValidationResult {
    const c = new Collector();
    if (!isObject(input)) return { ok: false, errors: ['scene: expected a JSON object'] };

    if (input.schemaVersion !== SCENE_SCHEMA_VERSION) {
        return {
            ok: false,
            errors: [`schemaVersion: unsupported version ${JSON.stringify(input.schemaVersion)} (this build supports ${SCENE_SCHEMA_VERSION})`],
        };
    }
    if (!isNonEmptyString(input.id)) c.add('id', 'must be a non-empty string');
    if (typeof input.name !== 'string') c.add('name', 'must be a string');
    if (input.units !== 'meters') c.add('units', 'must be "meters"');
    for (const key of ['createdAt', 'updatedAt'] as const) {
        if (typeof input[key] !== 'string' || Number.isNaN(Date.parse(input[key] as string))) c.add(key, 'must be an ISO date string');
    }

    const s = input.settings;
    if (!isObject(s)) {
        c.add('settings', 'must be an object');
    } else {
        c.positive('settings.gridSizeM', s.gridSizeM);
        if (typeof s.gridSnap !== 'boolean') c.add('settings.gridSnap', 'must be a boolean');
        if (!['free', 15, 45, 90].includes(s.snapAngle as never)) c.add('settings.snapAngle', 'must be "free", 15, 45, or 90');
        if (!isFiniteNumber(s.snapToleranceDeg) || s.snapToleranceDeg < 0 || s.snapToleranceDeg > 45) {
            c.add('settings.snapToleranceDeg', 'must be between 0 and 45');
        }
    }

    const ids = new Set<string>();
    const checkId = (path: string, id: unknown): void => {
        if (!isNonEmptyString(id)) {
            c.add(`${path}.id`, 'must be a non-empty string');
            return;
        }
        if (ids.has(id)) c.add(`${path}.id`, `duplicate id "${id}"`);
        ids.add(id);
    };

    const definitionIds = new Set<string>();
    if (!Array.isArray(input.definitions)) {
        c.add('definitions', 'must be an array');
    } else {
        if (input.definitions.length > MAX_DEFINITIONS) c.add('definitions', `too many definitions (${input.definitions.length} > ${MAX_DEFINITIONS})`);
        input.definitions.forEach((d, i) => {
            const path = `definitions[${i}]`;
            if (!isObject(d)) {
                c.add(path, 'must be an object');
                return;
            }
            checkId(path, d.id);
            if (isNonEmptyString(d.id)) definitionIds.add(d.id);
            if (typeof d.name !== 'string') c.add(`${path}.name`, 'must be a string');
            c.color(`${path}.color`, d.color, false);
            c.finiteTuple(`${path}.defaultDimensions`, d.defaultDimensions, 3, true);
            c.optionalString(`${path}.category`, d.category);
        });
    }

    if (!Array.isArray(input.objects)) {
        c.add('objects', 'must be an array');
    } else if (input.objects.length > MAX_SCENE_OBJECTS) {
        c.add('objects', `suspiciously large object count (${input.objects.length} > ${MAX_SCENE_OBJECTS})`);
    } else {
        input.objects.forEach((o, i) => {
            const path = `objects[${i}]`;
            if (!isObject(o)) {
                c.add(path, 'must be an object');
                return;
            }
            checkId(path, o.id);
            c.optionalString(`${path}.name`, o.name);
            c.provenance(`${path}.provenance`, o.provenance);
            switch (o.kind) {
                case 'box':
                    if (!isNonEmptyString(o.definitionId) || !definitionIds.has(o.definitionId)) {
                        c.add(`${path}.definitionId`, `references missing definition ${JSON.stringify(o.definitionId)}`);
                    }
                    c.finiteTuple(`${path}.position`, o.position, 3);
                    if (!isFiniteNumber(o.yaw)) c.add(`${path}.yaw`, 'must be a finite number (radians)');
                    if (o.dimensionsOverride !== undefined) c.finiteTuple(`${path}.dimensionsOverride`, o.dimensionsOverride, 3, true);
                    break;
                case 'wall':
                    c.finiteTuple(`${path}.start`, o.start, 2);
                    c.finiteTuple(`${path}.end`, o.end, 2);
                    c.positive(`${path}.heightM`, o.heightM);
                    c.positive(`${path}.thicknessM`, o.thicknessM);
                    c.color(`${path}.color`, o.color, true);
                    break;
                case 'region': {
                    if (typeof o.name !== 'string') c.add(`${path}.name`, 'must be a string');
                    c.color(`${path}.color`, o.color, true);
                    if (!Array.isArray(o.polygon)) {
                        c.add(`${path}.polygon`, 'must be an array of [x, z] points');
                        break;
                    }
                    if (o.polygon.length > MAX_POLYGON_VERTICES) {
                        c.add(`${path}.polygon`, `too many vertices (${o.polygon.length} > ${MAX_POLYGON_VERTICES})`);
                        break;
                    }
                    const allFinite = o.polygon.every((p, j) => c.finiteTuple(`${path}.polygon[${j}]`, p, 2));
                    if (allFinite) {
                        const problem = polygonProblem(o.polygon as [number, number][]);
                        if (problem) c.add(`${path}.polygon`, problem);
                    }
                    break;
                }
                default:
                    c.add(`${path}.kind`, `unknown object kind ${JSON.stringify(o.kind)} (expected box, wall, or region)`);
            }
        });
    }

    if (input.source !== undefined) {
        const src = input.source;
        if (!isObject(src)) {
            c.add('source', 'must be an object');
        } else {
            if (!['top-down', 'isometric', 'unknown'].includes(src.kind as string)) c.add('source.kind', 'must be top-down, isometric, or unknown');
            c.optionalString('source.imageKey', src.imageKey);
            c.optionalString('source.fileName', src.fileName);
            c.optionalString('source.mimeType', src.mimeType);
            for (const key of ['widthPx', 'heightPx'] as const) {
                if (src[key] !== undefined) c.positive(`source.${key}`, src[key]);
            }
            if (src.calibration !== undefined) {
                const cal = src.calibration;
                if (!isObject(cal)) c.add('source.calibration', 'must be an object');
                else {
                    c.finiteTuple('source.calibration.pixelToWorld', cal.pixelToWorld, 6);
                    if (cal.method !== 'reconstructed' && cal.method !== 'manual') c.add('source.calibration.method', 'must be reconstructed or manual');
                }
            }
        }
    }

    if (c.errors.length > 0) return { ok: false, errors: c.errors };
    return { ok: true, scene: input as unknown as SceneDocument };
}
