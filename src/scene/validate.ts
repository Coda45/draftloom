// Structural and semantic validation for untrusted SceneDocument input.
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

    optionalString(path: string, v: unknown): void {
        if (v !== undefined && typeof v !== 'string') this.add(path, 'must be a string when present');
    }

    stringArray(path: string, v: unknown): void {
        if (v === undefined) return;
        if (!Array.isArray(v) || v.some((item) => typeof item !== 'string')) this.add(path, 'must be an array of strings');
    }

    provenance(path: string, v: unknown): void {
        if (v === undefined) return;
        if (!isObject(v)) {
            this.add(path, 'must be an object');
            return;
        }
        this.optionalString(`${path}.sourceId`, v.sourceId);
        if (!['manual', 'detected', 'inferred'].includes(v.method as string)) {
            this.add(`${path}.method`, 'must be manual, detected, or inferred');
        }
        if (v.confidence !== undefined && (!isFiniteNumber(v.confidence) || v.confidence < 0 || v.confidence > 1)) {
            this.add(`${path}.confidence`, 'must be a number between 0 and 1');
        }
        this.stringArray(`${path}.notes`, v.notes);
    }
}

function legacyProvenance(value: unknown): unknown {
    const p = isObject(value) ? value : {};
    const origin = p.origin;
    const method = origin === 'reconstructed' ? (p.inferred === true ? 'inferred' : 'detected') : 'manual';
    const notes: string[] = [];
    if (typeof p.note === 'string' && p.note.trim()) notes.push(p.note);
    return {
        method,
        ...(isFiniteNumber(p.confidence) ? { confidence: p.confidence } : {}),
        ...(notes.length > 0 ? { notes } : {}),
    };
}

/** Converts the editor's pre-contract version-1 shape without mutating input. */
export function migrateLegacyScene(input: unknown): unknown {
    if (!isObject(input) || (input.units !== 'meters' && !Array.isArray(input.definitions))) return input;

    const legacyDefinitions = Array.isArray(input.definitions) ? input.definitions : [];
    const definitions: Record<string, unknown> = {};
    for (const value of legacyDefinitions) {
        if (!isObject(value) || !isNonEmptyString(value.id)) continue;
        definitions[value.id] = {
            id: value.id,
            name: value.name,
            dimensions: value.defaultDimensions,
            color: value.color,
            ...(typeof value.assetId === 'string' ? { assetId: value.assetId } : {}),
        };
    }

    const objects = Array.isArray(input.objects)
        ? input.objects.map((value) => {
              if (!isObject(value)) return value;
              if (value.kind === 'box') {
                  return {
                      id: value.id,
                      kind: 'box',
                      definitionId: value.definitionId,
                      ...(typeof value.name === 'string' ? { name: value.name } : {}),
                      position: value.position,
                      rotationY: value.yaw,
                      ...(value.dimensionsOverride !== undefined ? { dimensionsOverride: value.dimensionsOverride } : {}),
                      provenance: legacyProvenance(value.provenance),
                  };
              }
              if (value.kind === 'wall') {
                  return {
                      id: value.id,
                      kind: 'wall',
                      ...(typeof value.name === 'string' ? { name: value.name } : {}),
                      start: value.start,
                      end: value.end,
                      baseY: 0,
                      height: value.heightM,
                      thickness: value.thicknessM,
                      provenance: legacyProvenance(value.provenance),
                  };
              }
              if (value.kind === 'region') {
                  return {
                      id: value.id,
                      kind: 'region',
                      name: value.name,
                      polygon: value.polygon,
                      provenance: legacyProvenance(value.provenance),
                  };
              }
              return value;
          })
        : input.objects;

    const source = isObject(input.source) ? input.source : null;
    const calibration = source && isObject(source.calibration) && Array.isArray(source.calibration.pixelToWorld) ? source.calibration.pixelToWorld : null;
    const sources = source
        ? [
              {
                  id: 'source-legacy',
                  name: typeof source.fileName === 'string' ? source.fileName : 'Source image',
                  mode: source.kind === 'isometric' ? 'isometric' : 'floorplan',
                  ...(typeof source.imageKey === 'string' ? { imageKey: source.imageKey } : {}),
                  ...(typeof source.mimeType === 'string' ? { mimeType: source.mimeType } : {}),
                  ...(isFiniteNumber(source.widthPx) ? { widthPx: source.widthPx } : {}),
                  ...(isFiniteNumber(source.heightPx) ? { heightPx: source.heightPx } : {}),
                  ...(calibration?.length === 6
                      ? { pixelToWorldXZ: [calibration[0], calibration[3], calibration[1], calibration[4], calibration[2], calibration[5]] }
                      : {}),
                  ...(isObject(source.calibration) && (source.calibration.method === 'manual' || source.calibration.method === 'reconstructed')
                      ? { calibrationMethod: source.calibration.method === 'manual' ? 'manual' : 'detected' }
                      : {}),
              },
          ]
        : [];

    const settings = isObject(input.settings) ? input.settings : {};
    return {
        schemaVersion: input.schemaVersion,
        id: input.id,
        name: input.name,
        units: 'm',
        upAxis: 'Y',
        definitions,
        objects,
        sources,
        settings: {
            displayUnit: 'm',
            gridSizeM: settings.gridSizeM,
            gridSnap: settings.gridSnap === true,
            snapAngleDeg: settings.snapAngle === 'free' ? 0 : settings.snapAngle,
            snapToleranceDeg: settings.snapToleranceDeg,
        },
        ...(typeof input.createdAt === 'string' ? { createdAt: input.createdAt } : {}),
        updatedAt: input.updatedAt,
    };
}

function applyContractDefaults(input: unknown): unknown {
    if (!isObject(input) || input.units !== 'm' || !isObject(input.settings) || input.settings.gridSnap !== undefined) return input;
    return { ...input, settings: { ...input.settings, gridSnap: false } };
}

/** Validates unknown input as the authoritative version-1 SceneDocument. */
export function validateScene(input: unknown): ValidationResult {
    input = applyContractDefaults(migrateLegacyScene(input));
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
    if (input.units !== 'm') c.add('units', 'must be "m"');
    if (input.upAxis !== 'Y') c.add('upAxis', 'must be "Y"');
    if (input.createdAt !== undefined && (typeof input.createdAt !== 'string' || Number.isNaN(Date.parse(input.createdAt)))) c.add('createdAt', 'must be an ISO date string when present');
    if (typeof input.updatedAt !== 'string' || Number.isNaN(Date.parse(input.updatedAt))) c.add('updatedAt', 'must be an ISO date string');

    const settings = input.settings;
    if (!isObject(settings)) {
        c.add('settings', 'must be an object');
    } else {
        if (!['m', 'cm', 'ft', 'in'].includes(settings.displayUnit as string)) c.add('settings.displayUnit', 'must be m, cm, ft, or in');
        c.positive('settings.gridSizeM', settings.gridSizeM);
        if (typeof settings.gridSnap !== 'boolean') c.add('settings.gridSnap', 'must be a boolean');
        if (![0, 15, 45, 90].includes(settings.snapAngleDeg as number)) c.add('settings.snapAngleDeg', 'must be 0, 15, 45, or 90');
        if (!isFiniteNumber(settings.snapToleranceDeg) || settings.snapToleranceDeg < 0 || settings.snapToleranceDeg > 45) {
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
    if (!isObject(input.definitions)) {
        c.add('definitions', 'must be an object keyed by definition ID');
    } else {
        const entries = Object.entries(input.definitions);
        if (entries.length > MAX_DEFINITIONS) c.add('definitions', `too many definitions (${entries.length} > ${MAX_DEFINITIONS})`);
        for (const [key, value] of entries) {
            const path = `definitions.${key}`;
            if (!isObject(value)) {
                c.add(path, 'must be an object');
                continue;
            }
            checkId(path, value.id);
            if (value.id !== key) c.add(`${path}.id`, `must match definition key "${key}"`);
            if (isNonEmptyString(value.id)) definitionIds.add(value.id);
            if (typeof value.name !== 'string') c.add(`${path}.name`, 'must be a string');
            c.finiteTuple(`${path}.dimensions`, value.dimensions, 3, true);
            if (typeof value.color !== 'string' || !COLOR_RE.test(value.color)) c.add(`${path}.color`, 'expected a #RRGGBB color');
            c.optionalString(`${path}.assetId`, value.assetId);
        }
    }

    if (!Array.isArray(input.objects)) {
        c.add('objects', 'must be an array');
    } else if (input.objects.length > MAX_SCENE_OBJECTS) {
        c.add('objects', `suspiciously large object count (${input.objects.length} > ${MAX_SCENE_OBJECTS})`);
    } else {
        input.objects.forEach((value, i) => {
            const path = `objects[${i}]`;
            if (!isObject(value)) {
                c.add(path, 'must be an object');
                return;
            }
            checkId(path, value.id);
            c.provenance(`${path}.provenance`, value.provenance);
            switch (value.kind) {
                case 'box':
                    c.optionalString(`${path}.name`, value.name);
                    if (!isNonEmptyString(value.definitionId) || !definitionIds.has(value.definitionId)) {
                        c.add(`${path}.definitionId`, `references missing definition ${JSON.stringify(value.definitionId)}`);
                    }
                    c.finiteTuple(`${path}.position`, value.position, 3);
                    if (!isFiniteNumber(value.rotationY)) c.add(`${path}.rotationY`, 'must be a finite number (radians)');
                    if (value.dimensionsOverride !== undefined) c.finiteTuple(`${path}.dimensionsOverride`, value.dimensionsOverride, 3, true);
                    break;
                case 'wall':
                    c.optionalString(`${path}.name`, value.name);
                    c.finiteTuple(`${path}.start`, value.start, 2);
                    c.finiteTuple(`${path}.end`, value.end, 2);
                    if (!isFiniteNumber(value.baseY)) c.add(`${path}.baseY`, 'must be a finite number');
                    c.positive(`${path}.height`, value.height);
                    c.positive(`${path}.thickness`, value.thickness);
                    break;
                case 'region': {
                    if (typeof value.name !== 'string') c.add(`${path}.name`, 'must be a string');
                    if (!Array.isArray(value.polygon)) {
                        c.add(`${path}.polygon`, 'must be an array of [x, z] points');
                        break;
                    }
                    if (value.polygon.length > MAX_POLYGON_VERTICES) {
                        c.add(`${path}.polygon`, `too many vertices (${value.polygon.length} > ${MAX_POLYGON_VERTICES})`);
                        break;
                    }
                    const allFinite = value.polygon.every((p, j) => c.finiteTuple(`${path}.polygon[${j}]`, p, 2));
                    if (allFinite) {
                        const problem = polygonProblem(value.polygon as [number, number][]);
                        if (problem) c.add(`${path}.polygon`, problem);
                    }
                    break;
                }
                default:
                    c.add(`${path}.kind`, `unknown object kind ${JSON.stringify(value.kind)} (expected box, wall, or region)`);
            }
        });
    }

    if (!Array.isArray(input.sources)) {
        c.add('sources', 'must be an array');
    } else {
        input.sources.forEach((value, i) => {
            const path = `sources[${i}]`;
            if (!isObject(value)) {
                c.add(path, 'must be an object');
                return;
            }
            checkId(path, value.id);
            if (typeof value.name !== 'string') c.add(`${path}.name`, 'must be a string');
            if (!['floorplan', 'isometric', 'orthographic'].includes(value.mode as string)) c.add(`${path}.mode`, 'must be floorplan, isometric, or orthographic');
            c.optionalString(`${path}.imageKey`, value.imageKey);
            c.optionalString(`${path}.mimeType`, value.mimeType);
            if (value.widthPx !== undefined) c.positive(`${path}.widthPx`, value.widthPx);
            if (value.heightPx !== undefined) c.positive(`${path}.heightPx`, value.heightPx);
            if (value.pixelToWorldXZ !== undefined) c.finiteTuple(`${path}.pixelToWorldXZ`, value.pixelToWorldXZ, 6);
            if (value.calibrationMethod !== undefined && !['manual', 'detected', 'inferred'].includes(value.calibrationMethod as string)) {
                c.add(`${path}.calibrationMethod`, 'must be manual, detected, or inferred');
            }
            c.stringArray(`${path}.notes`, value.notes);
        });
    }

    if (c.errors.length > 0) return { ok: false, errors: c.errors };
    return { ok: true, scene: input as unknown as SceneDocument };
}
