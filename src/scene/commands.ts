// Typed scene edit commands and the pure reducer that applies them.
// Every command returns a new SceneDocument; inputs are never mutated.
import { polygonProblem } from './geometry';
import { newId } from './ids';
import {
    DEFAULT_SETTINGS,
    SCENE_SCHEMA_VERSION,
    type BoxInstance,
    type Dimensions,
    type ObjectDefinition,
    type Region,
    type SceneDocument,
    type SceneObject,
    type SceneSettings,
    type SourceReference,
    type Vec2,
    type Vec3,
    type WallSegment,
} from './schema';

export type DefinitionPatch = Partial<Pick<ObjectDefinition, 'name' | 'color' | 'dimensions' | 'assetId'>>;

export type SceneCommand =
    | { type: 'loadScene'; scene: SceneDocument }
    | { type: 'resetScene' }
    | { type: 'renameScene'; name: string }
    | { type: 'updateSettings'; patch: Partial<SceneSettings> }
    | { type: 'addDefinition'; definition: ObjectDefinition }
    | { type: 'editDefinition'; id: string; patch: DefinitionPatch }
    | { type: 'deleteDefinition'; id: string }
    | { type: 'addBox'; box: BoxInstance }
    | { type: 'addWall'; wall: WallSegment }
    | { type: 'addRegion'; region: Region }
    | { type: 'deleteObject'; id: string }
    | { type: 'renameObject'; id: string; name: string }
    | { type: 'moveBox'; id: string; position: Vec3 }
    | { type: 'setBoxRotation'; id: string; rotationY: number }
    | { type: 'setBoxDefinition'; id: string; definitionId: string }
    | { type: 'setInstanceDimensionsOverride'; id: string; dimensions: Dimensions }
    | { type: 'clearInstanceDimensionsOverride'; id: string }
    | { type: 'moveWallEndpoint'; id: string; endpoint: 'start' | 'end'; point: Vec2 }
    | { type: 'moveWall'; id: string; start: Vec2; end: Vec2 }
    | { type: 'setWallBaseY'; id: string; baseY: number }
    | { type: 'setWallHeight'; id: string; height: number }
    | { type: 'setWallThickness'; id: string; thickness: number }
    | { type: 'moveRegionVertex'; id: string; index: number; point: Vec2 }
    | { type: 'setRegionPolygon'; id: string; polygon: Vec2[] }
    | { type: 'renameRegion'; id: string; name: string }
    | { type: 'applyPackingResult'; boxes: BoxInstance[] }
    | { type: 'setSource'; source: SourceReference | undefined }
    // Rescale about the origin. Plan (X/Z) only unless includeHeights; `calibration`
    // relabels the source calibrations it rescales.
    | { type: 'scaleScene'; factor: number; includeHeights?: boolean; calibration?: SourceReference['calibrationMethod'] };

export class SceneCommandError extends Error {}

export function createEmptyScene(name = 'Untitled project'): SceneDocument {
    const now = new Date().toISOString();
    return {
        schemaVersion: SCENE_SCHEMA_VERSION,
        id: newId('scene'),
        name,
        units: 'm',
        upAxis: 'Y',
        updatedAt: now,
        settings: { ...DEFAULT_SETTINGS },
        definitions: {},
        objects: [],
        sources: [],
        createdAt: now,
    };
}

function assertPositiveDims(d: Dimensions): void {
    if (d.length !== 3 || d.some((n) => !Number.isFinite(n) || n <= 0)) {
        throw new SceneCommandError('Dimensions must be three positive, finite numbers.');
    }
}

function assertFinite(values: number[], what: string): void {
    if (values.some((n) => !Number.isFinite(n))) throw new SceneCommandError(`${what} must be finite numbers.`);
}

function assertNewIds(scene: SceneDocument, ids: string[]): void {
    const existing = new Set([...scene.objects.map((o) => o.id), ...Object.keys(scene.definitions), ...scene.sources.map((s) => s.id)]);
    for (const id of ids) {
        if (existing.has(id)) throw new SceneCommandError(`ID "${id}" already exists.`);
        existing.add(id);
    }
}

function updateObject<K extends SceneObject['kind']>(
    scene: SceneDocument,
    id: string,
    kind: K,
    fn: (obj: Extract<SceneObject, { kind: K }>) => Extract<SceneObject, { kind: K }>,
): SceneDocument {
    let found = false;
    const objects = scene.objects.map((o) => {
        if (o.id !== id) return o;
        if (o.kind !== kind) throw new SceneCommandError(`Object "${id}" is a ${o.kind}, not a ${kind}.`);
        found = true;
        return fn(o as Extract<SceneObject, { kind: K }>);
    });
    if (!found) throw new SceneCommandError(`No ${kind} with ID "${id}".`);
    return { ...scene, objects };
}

const scaleVec = <T extends number[]>(v: T, f: number): T => v.map((n) => n * f) as T;

/**
 * Rescales the scene about the origin to confirm an assumed import scale. A
 * floor-plan scale only determines plan (X/Z) measurements, so heights and Y
 * positions keep their values unless includeHeights is set.
 */
function scaleScene(scene: SceneDocument, f: number, includeHeights: boolean, calibration?: SourceReference['calibrationMethod']): SceneDocument {
    const fy = includeHeights ? f : 1;
    const xyz = <T extends [number, number, number]>(v: T): T => [v[0] * f, v[1] * fy, v[2] * f] as T;
    const definitions: Record<string, ObjectDefinition> = {};
    for (const [id, d] of Object.entries(scene.definitions)) definitions[id] = { ...d, dimensions: xyz(d.dimensions) };
    const objects = scene.objects.map((o): SceneObject => {
        if (o.kind === 'box') {
            const b: BoxInstance = { ...o, position: xyz(o.position) };
            if (o.dimensionsOverride) b.dimensionsOverride = xyz(o.dimensionsOverride);
            return b;
        }
        if (o.kind === 'wall') {
            // Thickness is a plan (footprint) measurement.
            return { ...o, start: scaleVec(o.start, f), end: scaleVec(o.end, f), baseY: o.baseY * fy, height: o.height * fy, thickness: o.thickness * f };
        }
        return { ...o, polygon: o.polygon.map((p) => scaleVec(p, f)) };
    });
    // world = M * pixel, so scaling the world scales every element of the calibration.
    const sources = scene.sources.map((s) =>
        s.pixelToWorldXZ ? { ...s, pixelToWorldXZ: scaleVec(s.pixelToWorldXZ, f), ...(calibration ? { calibrationMethod: calibration } : {}) } : s,
    );
    return { ...scene, definitions, objects, sources };
}

/** Applies a command and returns the next scene. Throws SceneCommandError for invalid edits. */
export function applyCommand(scene: SceneDocument, cmd: SceneCommand): SceneDocument {
    const next = reduce(scene, cmd);
    // Loading or resetting is not an edit, so the document's own timestamps are kept.
    if (next === scene || cmd.type === 'loadScene' || cmd.type === 'resetScene') return next;
    return { ...next, updatedAt: new Date().toISOString() };
}

function reduce(scene: SceneDocument, cmd: SceneCommand): SceneDocument {
    switch (cmd.type) {
        case 'loadScene':
            return cmd.scene;
        case 'resetScene':
            return createEmptyScene();
        case 'renameScene':
            return { ...scene, name: cmd.name };
        case 'updateSettings':
            return { ...scene, settings: { ...scene.settings, ...cmd.patch } };

        case 'addDefinition':
            assertNewIds(scene, [cmd.definition.id]);
            assertPositiveDims(cmd.definition.dimensions);
            return { ...scene, definitions: { ...scene.definitions, [cmd.definition.id]: cmd.definition } };
        case 'editDefinition': {
            const definition = scene.definitions[cmd.id];
            if (!definition) throw new SceneCommandError(`No definition with ID "${cmd.id}".`);
            if (cmd.patch.dimensions) assertPositiveDims(cmd.patch.dimensions);
            // Instances reference the definition, so non-overridden instances follow automatically
            // while instances with dimensionsOverride keep their own values.
            return {
                ...scene,
                definitions: { ...scene.definitions, [cmd.id]: { ...definition, ...cmd.patch } },
            };
        }
        case 'deleteDefinition': {
            if (scene.objects.some((o) => o.kind === 'box' && o.definitionId === cmd.id)) {
                throw new SceneCommandError('Delete or reassign the boxes that use this definition first.');
            }
            const definitions = { ...scene.definitions };
            delete definitions[cmd.id];
            return { ...scene, definitions };
        }

        case 'addBox':
            assertNewIds(scene, [cmd.box.id]);
            if (!scene.definitions[cmd.box.definitionId]) {
                throw new SceneCommandError(`Definition "${cmd.box.definitionId}" does not exist.`);
            }
            assertFinite([...cmd.box.position, cmd.box.rotationY], 'Box position and rotation');
            return { ...scene, objects: [...scene.objects, cmd.box] };
        case 'addWall':
            assertNewIds(scene, [cmd.wall.id]);
            assertFinite([...cmd.wall.start, ...cmd.wall.end], 'Wall endpoints');
            assertFinite([...cmd.wall.start, ...cmd.wall.end, cmd.wall.baseY], 'Wall geometry');
            if (!(cmd.wall.height > 0) || !(cmd.wall.thickness > 0)) throw new SceneCommandError('Wall height and thickness must be positive.');
            return { ...scene, objects: [...scene.objects, cmd.wall] };
        case 'addRegion': {
            assertNewIds(scene, [cmd.region.id]);
            const problem = polygonProblem(cmd.region.polygon);
            if (problem) throw new SceneCommandError(`Invalid region: ${problem}.`);
            return { ...scene, objects: [...scene.objects, cmd.region] };
        }
        case 'deleteObject':
            if (!scene.objects.some((o) => o.id === cmd.id)) return scene;
            return { ...scene, objects: scene.objects.filter((o) => o.id !== cmd.id) };
        case 'renameObject': {
            const objects = scene.objects.map((o) => {
                if (o.id !== cmd.id || o.kind === 'region') return o;
                const name = cmd.name.trim();
                return { ...o, name: name || undefined };
            });
            return { ...scene, objects };
        }
        case 'moveBox':
            assertFinite(cmd.position, 'Box position');
            return updateObject(scene, cmd.id, 'box', (b) => ({ ...b, position: [...cmd.position] as Vec3 }));
        case 'setBoxRotation':
            assertFinite([cmd.rotationY], 'Rotation');
            return updateObject(scene, cmd.id, 'box', (b) => ({ ...b, rotationY: cmd.rotationY }));
        case 'setBoxDefinition':
            if (!scene.definitions[cmd.definitionId]) throw new SceneCommandError(`Definition "${cmd.definitionId}" does not exist.`);
            return updateObject(scene, cmd.id, 'box', (b) => ({ ...b, definitionId: cmd.definitionId }));
        case 'setInstanceDimensionsOverride':
            assertPositiveDims(cmd.dimensions);
            // Position is the bottom center, so resizing keeps the base anchored.
            return updateObject(scene, cmd.id, 'box', (b) => ({ ...b, dimensionsOverride: [...cmd.dimensions] as Dimensions }));
        case 'clearInstanceDimensionsOverride':
            return updateObject(scene, cmd.id, 'box', (b) => {
                const { dimensionsOverride: _removed, ...rest } = b;
                return rest;
            });

        case 'moveWallEndpoint':
            assertFinite(cmd.point, 'Wall endpoint');
            return updateObject(scene, cmd.id, 'wall', (w) => ({ ...w, [cmd.endpoint]: [...cmd.point] as Vec2 }));
        case 'moveWall':
            assertFinite([...cmd.start, ...cmd.end], 'Wall endpoints');
            return updateObject(scene, cmd.id, 'wall', (w) => ({ ...w, start: [...cmd.start] as Vec2, end: [...cmd.end] as Vec2 }));
        case 'setWallBaseY':
            if (!Number.isFinite(cmd.baseY)) throw new SceneCommandError('Wall base Y must be finite.');
            return updateObject(scene, cmd.id, 'wall', (w) => ({ ...w, baseY: cmd.baseY }));
        case 'setWallHeight':
            if (!(cmd.height > 0) || !Number.isFinite(cmd.height)) throw new SceneCommandError('Wall height must be positive.');
            return updateObject(scene, cmd.id, 'wall', (w) => ({ ...w, height: cmd.height }));
        case 'setWallThickness':
            if (!(cmd.thickness > 0) || !Number.isFinite(cmd.thickness)) throw new SceneCommandError('Wall thickness must be positive.');
            return updateObject(scene, cmd.id, 'wall', (w) => ({ ...w, thickness: cmd.thickness }));

        case 'moveRegionVertex':
            return updateObject(scene, cmd.id, 'region', (r) => {
                if (cmd.index < 0 || cmd.index >= r.polygon.length) throw new SceneCommandError('Vertex index out of range.');
                const polygon = r.polygon.map((p, i) => (i === cmd.index ? ([...cmd.point] as Vec2) : p));
                const problem = polygonProblem(polygon);
                if (problem) throw new SceneCommandError(`That move would make the region invalid: ${problem}.`);
                return { ...r, polygon };
            });
        case 'setRegionPolygon':
            return updateObject(scene, cmd.id, 'region', (r) => {
                const problem = polygonProblem(cmd.polygon);
                if (problem) throw new SceneCommandError(`Invalid region: ${problem}.`);
                return { ...r, polygon: cmd.polygon.map((p) => [...p] as Vec2) };
            });
        case 'renameRegion':
            return updateObject(scene, cmd.id, 'region', (r) => ({ ...r, name: cmd.name }));

        case 'applyPackingResult': {
            if (cmd.boxes.length === 0) return scene;
            assertNewIds(scene, cmd.boxes.map((b) => b.id));
            for (const b of cmd.boxes) {
                if (!scene.definitions[b.definitionId]) throw new SceneCommandError(`Definition "${b.definitionId}" does not exist.`);
            }
            return { ...scene, objects: [...scene.objects, ...cmd.boxes] };
        }
        case 'setSource':
            if (cmd.source === undefined) return { ...scene, sources: scene.sources.slice(1) };
            return { ...scene, sources: [cmd.source, ...scene.sources.slice(1)] };
        case 'scaleScene':
            if (!Number.isFinite(cmd.factor) || cmd.factor <= 0) throw new SceneCommandError('Scale factor must be a positive, finite number.');
            if (cmd.factor === 1 && !cmd.calibration) return scene;
            return scaleScene(scene, cmd.factor, cmd.includeHeights ?? false, cmd.calibration);
    }
}

/** Commands that should not be recorded in undo history. */
export function isHistoryBoundary(cmd: SceneCommand): boolean {
    return cmd.type === 'loadScene' || cmd.type === 'resetScene';
}
