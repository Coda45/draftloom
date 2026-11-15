import { describe, expect, it } from 'vitest';
import {
    convexPolygonDistance,
    convexShapeInsidePolygon,
    rectangleCorners,
    snapAngle,
    yawFromDirection,
    rotateAboutY,
} from '../src/scene/geometry';
import type { Vec2 } from '../src/scene/schema';

const close = (a: Vec2, b: Vec2) => {
    expect(a[0]).toBeCloseTo(b[0], 9);
    expect(a[1]).toBeCloseTo(b[1], 9);
};

describe('geometry', () => {
    it('positive yaw turns +X toward -Z (matches Three.js rotation.y)', () => {
        close(rotateAboutY([1, 0], Math.PI / 2), [0, -1]);
        expect(yawFromDirection(0, -1)).toBeCloseTo(Math.PI / 2);
    });

    it('rotated footprint swaps width and depth at 90 degrees', () => {
        const c = rectangleCorners([0, 0], 2, 1, Math.PI / 2);
        const xs = c.map((p) => p[0]);
        const zs = c.map((p) => p[1]);
        expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1);
        expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2);
    });

    it('distance between edge-touching rectangles is zero, separated is exact', () => {
        const a = rectangleCorners([0, 0], 1, 1, 0);
        expect(convexPolygonDistance(a, rectangleCorners([1, 0], 1, 1, 0))).toBeCloseTo(0);
        expect(convexPolygonDistance(a, rectangleCorners([1.5, 0], 1, 1, 0))).toBeCloseTo(0.5);
        expect(convexPolygonDistance(a, rectangleCorners([0.5, 0], 1, 1, 0))).toBe(0);
    });

    it('detects shapes crossing a concave notch', () => {
        // U-shaped region with a slot cut down from the top between x=1.2 and x=1.4.
        const u: Vec2[] = [[0, 0], [1.2, 0], [1.2, 2], [1.4, 2], [1.4, 0], [3, 0], [3, 3], [0, 3]];
        expect(convexShapeInsidePolygon(rectangleCorners([1.3, 2.5], 2, 0.8, 0), u)).toBe(true);
        expect(convexShapeInsidePolygon(rectangleCorners([1.0, 1.0], 1.2, 1, 0), u)).toBe(false);
        expect(convexShapeInsidePolygon(rectangleCorners([0.5, 1.0], 1, 1, 0), u)).toBe(true);
    });

    it('snaps wall angles within tolerance only', () => {
        close(snapAngle([0, 0], [10, 0.5], 90, 8), [Math.hypot(10, 0.5), 0]);
        close(snapAngle([0, 0], [10, 5], 90, 8), [10, 5]);
        const s = snapAngle([0, 0], [10, 9], 45, 8);
        expect(s[0]).toBeCloseTo(s[1]);
        close(snapAngle([0, 0], [10, 9], 'free', 8), [10, 9]);
    });
});
