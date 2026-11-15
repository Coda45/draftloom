// Deterministic "Maximize Space" packing of box instances into a region.
// Tries regular grids for each allowed orientation and several grid offsets,
// keeps the placement with the highest valid count. Not claimed to be optimal.
import {
    boundsGap,
    boundsOf,
    boxFootprint,
    convexPolygonDistance,
    convexShapeInsidePolygon,
    distanceToPolygonBoundary,
    polygonProblem,
    rectangleCorners,
    wallFootprint,
    type Bounds2D,
} from '../../scene/geometry';
import { newId } from '../../scene/ids';
import type { BoxInstance, Region, SceneDocument, Vec2 } from '../../scene/schema';

export interface PackingOptions {
    regionId: string;
    definitionId: string;
    /** Minimum clear distance between placed boxes and from obstacles, meters. */
    gapM: number;
    /** Minimum clear distance from the region boundary, meters. Default 0. */
    boundaryMarginM?: number;
    /** Allowed yaw values in radians. Default [0, PI/2]. */
    orientations?: number[];
    /** Treat existing boxes and walls as obstacles. Default true. */
    avoidObstacles?: boolean;
    /** Number of grid offsets tried per axis. Default 6. */
    offsetSteps?: number;
}

export interface PackingResult {
    boxes: BoxInstance[];
    /** Yaw used by the winning layout, when any boxes were placed. */
    yaw: number | null;
    candidatesTested: number;
    diagnostics: string[];
}

const MAX_CANDIDATES_PER_LAYOUT = 20000;
const TOLERANCE = 1e-6;

interface Obstacle {
    shape: Vec2[];
    bounds: Bounds2D;
}

function obstaclesFor(scene: SceneDocument): Obstacle[] {
    const result: Obstacle[] = [];
    for (const o of scene.objects) {
        let shape: Vec2[] = [];
        if (o.kind === 'box') shape = boxFootprint(o, scene.definitions);
        else if (o.kind === 'wall') shape = wallFootprint(o);
        if (shape.length > 0) result.push({ shape, bounds: boundsOf(shape) });
    }
    return result;
}

export function packRegion(scene: SceneDocument, options: PackingOptions): PackingResult {
    const diagnostics: string[] = [];
    const empty = (msg: string): PackingResult => ({ boxes: [], yaw: null, candidatesTested: 0, diagnostics: [msg] });

    const region = scene.objects.find((o): o is Region => o.kind === 'region' && o.id === options.regionId);
    if (!region) return empty('Select a region to arrange objects in.');
    const problem = polygonProblem(region.polygon);
    if (problem) return empty(`The region is invalid: ${problem}.`);

    const def = scene.definitions.find((d) => d.id === options.definitionId);
    if (!def) return empty('Choose an object definition to place.');
    const [w, h, d] = def.defaultDimensions;
    if (!(w > 0 && d > 0 && h > 0)) return empty('The object definition must have positive dimensions.');

    const gap = options.gapM;
    if (!Number.isFinite(gap) || gap < 0) return empty('Gap must be zero or a positive number of meters.');
    const margin = options.boundaryMarginM ?? 0;
    if (!Number.isFinite(margin) || margin < 0) return empty('Boundary margin must be zero or positive.');

    const orientations = options.orientations && options.orientations.length > 0 ? options.orientations : [0, Math.PI / 2];
    const offsetSteps = Math.max(1, Math.floor(options.offsetSteps ?? 6));
    const obstacles = options.avoidObstacles === false ? [] : obstaclesFor(scene);
    const rb = boundsOf(region.polygon);

    let best: { centers: Vec2[]; yaw: number } | null = null;
    let tested = 0;

    for (const yaw of orientations) {
        // Footprint extents in world axes for this yaw (grid stays world-aligned).
        const probe = rectangleCorners([0, 0], w, d, yaw);
        const pb = boundsOf(probe);
        const ex = pb.maxX - pb.minX;
        const ez = pb.maxZ - pb.minZ;
        const stepX = ex + gap;
        const stepZ = ez + gap;
        const cols = Math.floor((rb.maxX - rb.minX + gap) / stepX) + 1;
        const rows = Math.floor((rb.maxZ - rb.minZ + gap) / stepZ) + 1;
        if (cols * rows > MAX_CANDIDATES_PER_LAYOUT) {
            diagnostics.push('The region is very large relative to the object; only part of the search ran.');
        }

        for (let oi = 0; oi < offsetSteps; oi++) {
            for (let oj = 0; oj < offsetSteps; oj++) {
                const offX = (stepX * oi) / offsetSteps;
                const offZ = (stepZ * oj) / offsetSteps;
                const centers: Vec2[] = [];
                let budget = MAX_CANDIDATES_PER_LAYOUT;
                for (let r = 0; r < rows && budget > 0; r++) {
                    for (let c = 0; c < cols && budget > 0; c++, budget--) {
                        tested++;
                        const center: Vec2 = [rb.minX + margin + ex / 2 + offX + c * stepX, rb.minZ + margin + ez / 2 + offZ + r * stepZ];
                        const shape = rectangleCorners(center, w, d, yaw);
                        if (!convexShapeInsidePolygon(shape, region.polygon)) continue;
                        if (margin > 0 && distanceToPolygonBoundary(shape, region.polygon) < margin - TOLERANCE) continue;
                        const sb = boundsOf(shape);
                        let blocked = false;
                        for (const ob of obstacles) {
                            if (boundsGap(sb, ob.bounds) >= gap + TOLERANCE) continue;
                            if (convexPolygonDistance(shape, ob.shape) < gap - TOLERANCE) {
                                blocked = true;
                                break;
                            }
                        }
                        if (!blocked) centers.push(center);
                    }
                }
                if (!best || centers.length > best.centers.length) best = { centers, yaw };
            }
        }
    }

    if (!best || best.centers.length === 0) {
        diagnostics.push(
            `No ${def.name} (${w.toFixed(2)} × ${d.toFixed(2)} m) fits in "${region.name}" with a ${gap.toFixed(2)} m gap` +
                (obstacles.length > 0 ? ' around existing objects.' : '.'),
        );
        return { boxes: [], yaw: null, candidatesTested: tested, diagnostics };
    }

    const boxes: BoxInstance[] = best.centers.map((c) => ({
        kind: 'box',
        id: newId('box'),
        definitionId: def.id,
        position: [c[0], 0, c[1]],
        yaw: best.yaw,
        provenance: { origin: 'packing', note: `Arranged in ${region.name}` },
    }));
    return { boxes, yaw: best.yaw, candidatesTested: tested, diagnostics };
}
