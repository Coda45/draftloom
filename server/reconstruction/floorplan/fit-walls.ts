import type { PixelSegment } from '../../../src/import/preprocess/types';

type Orientation = 'horizontal' | 'vertical';

function orientation(segment: PixelSegment): Orientation {
    return Math.abs(segment.end[0] - segment.start[0]) >= Math.abs(segment.end[1] - segment.start[1]) ? 'horizontal' : 'vertical';
}

export function fitWallSegments(segments: PixelSegment[], width: number, height: number): PixelSegment[] {
    const tolerance = Math.max(4, Math.min(40, Math.min(width, height) * 0.02));
    const fitted = segments.map((segment) => {
        if (orientation(segment) === 'horizontal') { const y = (segment.start[1] + segment.end[1]) / 2; return { ...segment, start: [segment.start[0], y] as [number, number], end: [segment.end[0], y] as [number, number] }; }
        const x = (segment.start[0] + segment.end[0]) / 2; return { ...segment, start: [x, segment.start[1]] as [number, number], end: [x, segment.end[1]] as [number, number] };
    });
    return fitted.map((segment, segmentIndex) => {
        const ownOrientation = orientation(segment); const points = [segment.start, segment.end] as const;
        const snapped = points.map((point) => {
            let best: [number, number] | undefined; let bestDistance = tolerance;
            for (let otherIndex = 0; otherIndex < fitted.length; otherIndex++) {
                if (otherIndex === segmentIndex) continue;
                const other = fitted[otherIndex]; if (orientation(other) === ownOrientation) continue;
                const intersection: [number, number] = ownOrientation === 'horizontal' ? [other.start[0], segment.start[1]] : [segment.start[0], other.start[1]];
                const otherFirst = ownOrientation === 'horizontal' ? Math.min(other.start[1], other.end[1]) : Math.min(other.start[0], other.end[0]);
                const otherLast = ownOrientation === 'horizontal' ? Math.max(other.start[1], other.end[1]) : Math.max(other.start[0], other.end[0]);
                const intersectionProjection = ownOrientation === 'horizontal' ? intersection[1] : intersection[0];
                if (intersectionProjection < otherFirst - tolerance || intersectionProjection > otherLast + tolerance) continue;
                const distance = Math.hypot(point[0] - intersection[0], point[1] - intersection[1]);
                if (distance <= bestDistance) { bestDistance = distance; best = intersection; }
            }
            return best ?? point;
        });
        return { ...segment, start: [...snapped[0]] as [number, number], end: [...snapped[1]] as [number, number] };
    });
}
