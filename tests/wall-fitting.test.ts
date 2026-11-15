import { describe, expect, it } from 'vitest';
import { fitWallSegments } from '../server/reconstruction/floorplan/fit-walls';
import type { PixelSegment } from '../src/import/preprocess/types';

describe('wall junction fitting', () => {
    it('prioritizes shared orthogonal corners over small image gaps', () => {
        const segments: PixelSegment[] = [
            { id: 'top', start: [12, 10], end: [88, 10], confidence: 0.9 },
            { id: 'right', start: [92, 14], end: [92, 86], confidence: 0.9 },
            { id: 'bottom', start: [88, 90], end: [12, 90], confidence: 0.9 },
            { id: 'left', start: [8, 86], end: [8, 14], confidence: 0.9 },
        ];
        const result = fitWallSegments(segments, 100, 100);
        expect(result).toEqual([
            { ...segments[0], start: [8, 10], end: [92, 10] },
            { ...segments[1], start: [92, 10], end: [92, 90] },
            { ...segments[2], start: [92, 90], end: [8, 90] },
            { ...segments[3], start: [8, 90], end: [8, 10] },
        ]);
    });

    it('does not connect endpoints to distant walls', () => {
        const segments: PixelSegment[] = [
            { id: 'horizontal', start: [10, 20], end: [58, 20], confidence: 0.8 },
            { id: 'vertical', start: [60, 60], end: [60, 90], confidence: 0.8 },
        ];
        expect(fitWallSegments(segments, 100, 100)).toEqual(segments);
    });
});
