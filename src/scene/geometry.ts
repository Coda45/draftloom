// Pure ground-plane geometry helpers. All points are [x, z] in meters.
import type { BoxInstance, Dimensions, ObjectDefinition, SceneDocument, Vec2, WallSegment } from './schema';

export const EPSILON = 1e-9;

export function sub(a: Vec2, b: Vec2): Vec2 {
    return [a[0] - b[0], a[1] - b[1]];
}

export function add(a: Vec2, b: Vec2): Vec2 {
    return [a[0] + b[0], a[1] + b[1]];
}

export function cross(a: Vec2, b: Vec2): number {
    return a[0] * b[1] - a[1] * b[0];
}

export function dot(a: Vec2, b: Vec2): number {
    return a[0] * b[0] + a[1] * b[1];
}

export function distance(a: Vec2, b: Vec2): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Signed shoelace area in the X/Z plane. */
export function signedArea(polygon: Vec2[]): number {
    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        area += a[0] * b[1] - b[0] * a[1];
    }
    return area / 2;
}

export function polygonArea(polygon: Vec2[]): number {
    return Math.abs(signedArea(polygon));
}

export function polygonCentroid(polygon: Vec2[]): Vec2 {
    const a = signedArea(polygon);
    if (Math.abs(a) < EPSILON) {
        const sum = polygon.reduce<Vec2>((acc, p) => add(acc, p), [0, 0]);
        return [sum[0] / polygon.length, sum[1] / polygon.length];
    }
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < polygon.length; i++) {
        const p = polygon[i];
        const q = polygon[(i + 1) % polygon.length];
        const f = p[0] * q[1] - q[0] * p[1];
        cx += (p[0] + q[0]) * f;
        cz += (p[1] + q[1]) * f;
    }
    return [cx / (6 * a), cz / (6 * a)];
}

function orientation(a: Vec2, b: Vec2, c: Vec2): number {
    const v = cross(sub(b, a), sub(c, a));
    if (Math.abs(v) < EPSILON) return 0;
    return v > 0 ? 1 : -1;
}

function onSegment(a: Vec2, b: Vec2, p: Vec2): boolean {
    return (
        Math.min(a[0], b[0]) - EPSILON <= p[0] &&
        p[0] <= Math.max(a[0], b[0]) + EPSILON &&
        Math.min(a[1], b[1]) - EPSILON <= p[1] &&
        p[1] <= Math.max(a[1], b[1]) + EPSILON
    );
}

/** True when segments ab and cd share any point (touching counts). */
export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
    const o1 = orientation(a, b, c);
    const o2 = orientation(a, b, d);
    const o3 = orientation(c, d, a);
    const o4 = orientation(c, d, b);
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSegment(a, b, c)) return true;
    if (o2 === 0 && onSegment(a, b, d)) return true;
    if (o3 === 0 && onSegment(c, d, a)) return true;
    if (o4 === 0 && onSegment(c, d, b)) return true;
    return false;
}

/** True when segments cross at a single interior point of both (no touching or collinear overlap). */
export function segmentsCrossProperly(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
    const o1 = orientation(a, b, c);
    const o2 = orientation(a, b, d);
    const o3 = orientation(c, d, a);
    const o4 = orientation(c, d, b);
    return o1 * o2 < 0 && o3 * o4 < 0;
}

/** True when two non-adjacent edges of the polygon intersect. */
export function isSelfIntersecting(polygon: Vec2[]): boolean {
    const n = polygon.length;
    for (let i = 0; i < n; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % n];
        for (let j = i + 1; j < n; j++) {
            // Adjacent edges share a vertex by construction.
            if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
            const c = polygon[j];
            const d = polygon[(j + 1) % n];
            if (segmentsIntersect(a, b, c, d)) return true;
        }
    }
    return false;
}

/** Explains why a polygon is unusable as a region, or returns null if valid. */
export function polygonProblem(polygon: Vec2[]): string | null {
    if (polygon.length < 3) return 'a region needs at least 3 vertices';
    for (const p of polygon) {
        if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return 'a vertex is not a finite number';
    }
    if (polygonArea(polygon) < 1e-6) return 'the region has zero area';
    if (isSelfIntersecting(polygon)) return 'the region edges cross each other';
    return null;
}

/** Ray-casting point-in-polygon test; points on the boundary count as inside. */
export function pointInPolygon(p: Vec2, polygon: Vec2[]): boolean {
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        if (orientation(a, b, p) === 0 && onSegment(a, b, p)) return true;
    }
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, zi] = polygon[i];
        const [xj, zj] = polygon[j];
        if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

/** Strictly-inside test: boundary points are excluded. */
export function pointStrictlyInPolygon(p: Vec2, polygon: Vec2[]): boolean {
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        if (orientation(a, b, p) === 0 && onSegment(a, b, p)) return false;
    }
    return pointInPolygon(p, polygon);
}

export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
    const ab = sub(b, a);
    const lenSq = dot(ab, ab);
    if (lenSq < EPSILON) return distance(p, a);
    const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / lenSq));
    return distance(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]);
}

export function segmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
    if (segmentsIntersect(a, b, c, d)) return 0;
    return Math.min(
        pointSegmentDistance(a, c, d),
        pointSegmentDistance(b, c, d),
        pointSegmentDistance(c, a, b),
        pointSegmentDistance(d, a, b),
    );
}

/** Corners of a yawed rectangle centered at `center` (counter-clockwise on screen order irrelevant). */
export function rectangleCorners(center: Vec2, widthX: number, depthZ: number, yaw: number): Vec2[] {
    const hw = widthX / 2;
    const hd = depthZ / 2;
    // Rotation about +Y: x' = x cos + z sin, z' = -x sin + z cos.
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const local: Vec2[] = [
        [-hw, -hd],
        [hw, -hd],
        [hw, hd],
        [-hw, hd],
    ];
    return local.map(([x, z]) => [center[0] + x * c + z * s, center[1] - x * s + z * c]);
}

export function rotateAboutY(point: Vec2, yaw: number): Vec2 {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return [point[0] * c + point[1] * s, -point[0] * s + point[1] * c];
}

export interface Bounds2D {
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
}

export function boundsOf(points: Vec2[]): Bounds2D {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of points) {
        minX = Math.min(minX, x);
        minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x);
        maxZ = Math.max(maxZ, z);
    }
    return { minX, minZ, maxX, maxZ };
}

export function boundsGap(a: Bounds2D, b: Bounds2D): number {
    const dx = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
    const dz = Math.max(0, Math.max(a.minZ, b.minZ) - Math.min(a.maxZ, b.maxZ));
    return Math.hypot(dx, dz);
}

function projectOnto(axis: Vec2, polygon: Vec2[]): [number, number] {
    let min = Infinity;
    let max = -Infinity;
    for (const p of polygon) {
        const v = dot(axis, p);
        min = Math.min(min, v);
        max = Math.max(max, v);
    }
    return [min, max];
}

/** Separating-axis test: true when two convex polygons overlap with positive area. */
export function convexPolygonsOverlap(a: Vec2[], b: Vec2[]): boolean {
    for (const poly of [a, b]) {
        for (let i = 0; i < poly.length; i++) {
            const edge = sub(poly[(i + 1) % poly.length], poly[i]);
            const axis: Vec2 = [-edge[1], edge[0]];
            const len = Math.hypot(axis[0], axis[1]);
            if (len < EPSILON) continue;
            const n: Vec2 = [axis[0] / len, axis[1] / len];
            const [minA, maxA] = projectOnto(n, a);
            const [minB, maxB] = projectOnto(n, b);
            if (maxA <= minB + 1e-9 || maxB <= minA + 1e-9) return false;
        }
    }
    return true;
}

/** Minimum distance between two convex polygons; 0 when they overlap. */
export function convexPolygonDistance(a: Vec2[], b: Vec2[]): number {
    if (convexPolygonsOverlap(a, b)) return 0;
    let best = Infinity;
    for (let i = 0; i < a.length; i++) {
        const a0 = a[i];
        const a1 = a[(i + 1) % a.length];
        for (let j = 0; j < b.length; j++) {
            best = Math.min(best, segmentDistance(a0, a1, b[j], b[(j + 1) % b.length]));
        }
    }
    return best;
}

/** Minimum distance from a convex polygon to a (possibly concave) polygon's boundary. */
export function distanceToPolygonBoundary(shape: Vec2[], polygon: Vec2[]): number {
    let best = Infinity;
    for (let i = 0; i < shape.length; i++) {
        const s0 = shape[i];
        const s1 = shape[(i + 1) % shape.length];
        for (let j = 0; j < polygon.length; j++) {
            best = Math.min(best, segmentDistance(s0, s1, polygon[j], polygon[(j + 1) % polygon.length]));
        }
    }
    return best;
}

/** True when a convex shape lies entirely inside a simple polygon (touching the boundary allowed). */
export function convexShapeInsidePolygon(shape: Vec2[], polygon: Vec2[]): boolean {
    for (const p of shape) {
        if (!pointInPolygon(p, polygon)) return false;
    }
    // A concave region's vertex or edge midpoint poking into the shape means part of it is outside.
    for (let j = 0; j < polygon.length; j++) {
        const v = polygon[j];
        const w = polygon[(j + 1) % polygon.length];
        if (pointStrictlyInPolygon(v, shape)) return false;
        if (pointStrictlyInPolygon([(v[0] + w[0]) / 2, (v[1] + w[1]) / 2], shape)) return false;
    }
    for (let i = 0; i < shape.length; i++) {
        const s0 = shape[i];
        const s1 = shape[(i + 1) % shape.length];
        const mid: Vec2 = [(s0[0] + s1[0]) / 2, (s0[1] + s1[1]) / 2];
        if (!pointInPolygon(mid, polygon)) return false;
        // A region edge crossing a shape edge transversally means the shape leaves the region.
        for (let j = 0; j < polygon.length; j++) {
            if (segmentsCrossProperly(s0, s1, polygon[j], polygon[(j + 1) % polygon.length])) return false;
        }
    }
    const center = shape.reduce<Vec2>((acc, p) => add(acc, p), [0, 0]);
    return pointInPolygon([center[0] / shape.length, center[1] / shape.length], polygon);
}

// --- Scene-aware helpers ---

export function findDefinition(scene: SceneDocument, id: string): ObjectDefinition | undefined {
    return scene.definitions[id];
}

/** Effective dimensions of a box: its override, else its definition's default. */
export function boxDimensions(box: BoxInstance, definitions: Record<string, ObjectDefinition>): Dimensions {
    if (box.dimensionsOverride) return box.dimensionsOverride;
    const def = definitions[box.definitionId];
    return def ? def.dimensions : [1, 1, 1];
}

export function boxFootprint(box: BoxInstance, definitions: Record<string, ObjectDefinition>): Vec2[] {
    const [w, , d] = boxDimensions(box, definitions);
    return rectangleCorners([box.position[0], box.position[2]], w, d, box.rotationY);
}

export function wallLength(wall: WallSegment): number {
    return distance(wall.start, wall.end);
}

/** Wall footprint as a rectangle along its centerline; empty for zero-length walls. */
export function wallFootprint(wall: WallSegment): Vec2[] {
    const len = wallLength(wall);
    if (len < 1e-6) return [];
    const dir: Vec2 = [(wall.end[0] - wall.start[0]) / len, (wall.end[1] - wall.start[1]) / len];
    const n: Vec2 = [-dir[1] * (wall.thickness / 2), dir[0] * (wall.thickness / 2)];
    return [add(wall.start, n), add(wall.end, n), sub(wall.end, n), sub(wall.start, n)];
}

/** Yaw that makes local +X point along (dx, dz). */
export function yawFromDirection(dx: number, dz: number): number {
    return Math.atan2(-dz, dx);
}

/**
 * Snap the direction from `from` to `to` to the nearest allowed increment when
 * within tolerance. Angles are measured with atan2 in the X/Z plane.
 */
export function snapAngle(from: Vec2, to: Vec2, increment: number, toleranceDeg: number): Vec2 {
    if (increment === 0) return to;
    const dx = to[0] - from[0];
    const dz = to[1] - from[1];
    const len = Math.hypot(dx, dz);
    if (len < EPSILON) return to;
    const angle = Math.atan2(dz, dx);
    const step = (increment * Math.PI) / 180;
    const snapped = Math.round(angle / step) * step;
    if (Math.abs(snapped - angle) > (toleranceDeg * Math.PI) / 180) return to;
    return [from[0] + Math.cos(snapped) * len, from[1] + Math.sin(snapped) * len];
}

export function snapToGrid(p: Vec2, grid: number): Vec2 {
    if (grid <= 0) return p;
    return [Math.round(p[0] / grid) * grid, Math.round(p[1] / grid) * grid];
}
