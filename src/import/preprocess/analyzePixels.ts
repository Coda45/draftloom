import type { ColorComponent, ImageObservations, PixelSegment } from './types';

function hex(r: number, g: number, b: number): string {
    return `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function luminanceThreshold(data: Uint8ClampedArray): number {
    const histogram = new Uint32Array(256); let samples = 0;
    const stride = Math.max(1, Math.floor(data.length / 4 / 100_000));
    for (let pixel = 0; pixel < data.length / 4; pixel += stride) {
        if (data[pixel * 4 + 3] < 128) continue;
        const value = Math.round(data[pixel * 4] * 0.2126 + data[pixel * 4 + 1] * 0.7152 + data[pixel * 4 + 2] * 0.0722);
        histogram[value]++; samples++;
    }
    const target = samples * 0.85; let accumulated = 0; let background = 255;
    for (let value = 0; value < histogram.length; value++) { accumulated += histogram[value]; if (accumulated >= target) { background = value; break; } }
    return Math.max(55, Math.min(100, background * 0.38));
}

function bands(counts: Uint32Array, threshold: number, gapTolerance: number): Array<[number, number]> {
    const result: Array<[number, number]> = [];
    let start = -1;
    let last = -1;
    for (let i = 0; i <= counts.length; i++) {
        if (i < counts.length && counts[i] >= threshold) {
            if (start < 0) start = i;
            last = i;
        } else if (start >= 0 && i - last > gapTolerance) {
            result.push([start, last]);
            start = -1;
            last = -1;
        }
    }
    return result;
}

function mergeWallSegments(segments: PixelSegment[], width: number, height: number): PixelSegment[] {
    const tolerance = Math.max(9, Math.min(width, height) * 0.025); const merged: PixelSegment[] = [];
    for (const segment of segments) {
        const horizontal = segment.start[1] === segment.end[1]; const axis = horizontal ? segment.start[1] : segment.start[0];
        const first = horizontal ? Math.min(segment.start[0], segment.end[0]) : Math.min(segment.start[1], segment.end[1]);
        const last = horizontal ? Math.max(segment.start[0], segment.end[0]) : Math.max(segment.start[1], segment.end[1]);
        const duplicate = merged.find((candidate) => {
            const candidateHorizontal = candidate.start[1] === candidate.end[1]; if (candidateHorizontal !== horizontal) return false;
            const candidateAxis = horizontal ? candidate.start[1] : candidate.start[0]; const candidateFirst = horizontal ? Math.min(candidate.start[0], candidate.end[0]) : Math.min(candidate.start[1], candidate.end[1]); const candidateLast = horizontal ? Math.max(candidate.start[0], candidate.end[0]) : Math.max(candidate.start[1], candidate.end[1]);
            const overlap = Math.max(0, Math.min(last, candidateLast) - Math.max(first, candidateFirst)); const shorter = Math.min(last - first, candidateLast - candidateFirst);
            return Math.abs(axis - candidateAxis) <= tolerance && overlap >= shorter * 0.8;
        });
        if (!duplicate) { merged.push({ ...segment, start: [...segment.start], end: [...segment.end] }); continue; }
        const duplicateAxis = horizontal ? duplicate.start[1] : duplicate.start[0]; const combinedAxis = (axis + duplicateAxis) / 2;
        const duplicateFirst = horizontal ? Math.min(duplicate.start[0], duplicate.end[0]) : Math.min(duplicate.start[1], duplicate.end[1]); const duplicateLast = horizontal ? Math.max(duplicate.start[0], duplicate.end[0]) : Math.max(duplicate.start[1], duplicate.end[1]);
        if (horizontal) { duplicate.start = [Math.min(first, duplicateFirst), combinedAxis]; duplicate.end = [Math.max(last, duplicateLast), combinedAxis]; }
        else { duplicate.start = [combinedAxis, Math.min(first, duplicateFirst)]; duplicate.end = [combinedAxis, Math.max(last, duplicateLast)]; }
        duplicate.confidence = Math.max(duplicate.confidence, segment.confidence);
    }
    return merged.map((segment, index) => ({ ...segment, id: `wall-${segment.start[1] === segment.end[1] ? 'h' : 'v'}-${index + 1}` })).slice(0, 200);
}

function wallSegments(dark: Uint8Array, width: number, height: number): PixelSegment[] {
    const rows = new Uint32Array(height);
    const columns = new Uint32Array(width);
    const rowSpans: Array<[number, number]> = Array.from({ length: height }, () => [0, -1]);
    const columnSpans: Array<[number, number]> = Array.from({ length: width }, () => [0, -1]);
    const gapTolerance = Math.max(1, Math.min(6, Math.round(Math.max(width, height) * 0.0025)));
    const driftTolerance = Math.max(1, Math.min(24, Math.round(Math.min(width, height) * 0.012)));
    const edgeMargin = Math.max(2, Math.round(Math.min(width, height) * 0.012));
    const longest = (length: number, at: (index: number) => boolean): [number, number] => {
        let best: [number, number] = [0, -1]; let start = -1; let lastDark = -1;
        for (let i = 0; i <= length; i++) {
            if (i < length && at(i)) { if (start < 0) start = i; lastDark = i; }
            else if (start >= 0 && i - lastDark > gapTolerance) { if (lastDark - start > best[1] - best[0]) best = [start, lastDark]; start = -1; lastDark = -1; }
        }
        return best;
    };
    const darkNearY = (x: number, y: number): boolean => { for (let yy = Math.max(0, y - driftTolerance); yy <= Math.min(height - 1, y + driftTolerance); yy++) if (dark[yy * width + x]) return true; return false; };
    const darkNearX = (x: number, y: number): boolean => { for (let xx = Math.max(0, x - driftTolerance); xx <= Math.min(width - 1, x + driftTolerance); xx++) if (dark[y * width + xx]) return true; return false; };
    for (let y = 0; y < height; y++) { rowSpans[y] = longest(width, (x) => darkNearY(x, y)); rows[y] = rowSpans[y][1] - rowSpans[y][0] + 1; }
    for (let x = 0; x < width; x++) { columnSpans[x] = longest(height, (y) => darkNearX(x, y)); columns[x] = columnSpans[x][1] - columnSpans[x][0] + 1; }
    const segments: PixelSegment[] = [];
    for (const [first, last] of bands(rows, Math.max(8, Math.round(width * 0.18)), gapTolerance)) {
        const y = (first + last) / 2;
        let min = width; let max = -1;
        for (let row = first; row <= last; row++) if (rowSpans[row][1] - rowSpans[row][0] > max - min) [min, max] = rowSpans[row];
        if (y > edgeMargin && y < height - 1 - edgeMargin && max - min >= width * 0.15) segments.push({ id: `wall-h-${segments.length + 1}`, start: [min, y], end: [max, y], confidence: Math.min(0.98, 0.65 + (max - min) / width * 0.3) });
    }
    for (const [first, last] of bands(columns, Math.max(8, Math.round(height * 0.18)), gapTolerance)) {
        const x = (first + last) / 2;
        let min = height; let max = -1;
        for (let column = first; column <= last; column++) if (columnSpans[column][1] - columnSpans[column][0] > max - min) [min, max] = columnSpans[column];
        if (x > edgeMargin && x < width - 1 - edgeMargin && max - min >= height * 0.15) segments.push({ id: `wall-v-${segments.length + 1}`, start: [x, min], end: [x, max], confidence: Math.min(0.98, 0.65 + (max - min) / height * 0.3) });
    }
    return mergeWallSegments(segments, width, height);
}

function maskColoredOutlines(dark: Uint8Array, components: ColorComponent[], width: number, height: number): void {
    for (const component of components) {
        const padding = Math.max(6, Math.min(24, Math.round(Math.min(component.bounds.width, component.bounds.height) * 0.12)));
        const minX = Math.max(0, component.bounds.x - padding); const maxX = Math.min(width - 1, component.bounds.x + component.bounds.width - 1 + padding);
        const minY = Math.max(0, component.bounds.y - padding); const maxY = Math.min(height - 1, component.bounds.y + component.bounds.height - 1 + padding);
        for (let y = minY; y <= maxY; y++) dark.fill(0, y * width + minX, y * width + maxX + 1);
    }
}

function periodicBands(candidates: Array<[number, number]>): Array<[number, number]> {
    if (candidates.length < 5) return [];
    const centers = candidates.map(([first, last]) => (first + last) / 2);
    const differences = centers.slice(1).map((center, index) => center - centers[index]).filter((difference) => difference >= 4);
    let spacing = 0; let spacingScore = 0;
    for (const candidate of differences) {
        const tolerance = Math.max(2, candidate * 0.18); const matching = differences.filter((difference) => Math.abs(difference - candidate) <= tolerance);
        if (matching.length > spacingScore) { spacingScore = matching.length; spacing = matching.reduce((sum, difference) => sum + difference, 0) / matching.length; }
    }
    if (spacingScore < 3 || spacing <= 0) return [];
    let best: Array<[number, number]> = [];
    for (const phase of centers) {
        const tolerance = Math.max(2, spacing * 0.18);
        const matching = candidates.filter((_, index) => { const periods = (centers[index] - phase) / spacing; return Math.abs(periods - Math.round(periods)) * spacing <= tolerance; });
        if (matching.length > best.length) best = matching;
    }
    return best.length >= 5 ? best : [];
}

function suppressGridLines(dark: Uint8Array, width: number, height: number): void {
    const radius = Math.max(1, Math.min(3, Math.round(Math.min(width, height) * 0.002)));
    const rowCounts = new Uint32Array(height); const columnCounts = new Uint32Array(width);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy++) if (dark[yy * width + x]) { rowCounts[y]++; break; }
        for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx++) if (dark[y * width + xx]) { columnCounts[x]++; break; }
    }
    const maximumThickness = radius * 2 + Math.max(2, Math.round(Math.min(width, height) * 0.004));
    const rows = periodicBands(bands(rowCounts, Math.round(width * 0.58), 0).filter(([first, last]) => last - first + 1 <= maximumThickness));
    const columns = periodicBands(bands(columnCounts, Math.round(height * 0.58), 0).filter(([first, last]) => last - first + 1 <= maximumThickness));
    const original = dark.slice(); const thicknessRadius = Math.max(2, Math.min(5, radius + 1));
    const horizontalThickness = (x: number, y: number) => { let count = 0; for (let yy = Math.max(0, y - thicknessRadius); yy <= Math.min(height - 1, y + thicknessRadius); yy++) count += original[yy * width + x]; return count; };
    const verticalThickness = (x: number, y: number) => { let count = 0; for (let xx = Math.max(0, x - thicknessRadius); xx <= Math.min(width - 1, x + thicknessRadius); xx++) count += original[y * width + xx]; return count; };
    for (const [first, last] of rows) for (let y = first; y <= last; y++) for (let x = 0; x < width; x++) if (horizontalThickness(x, y) < 3) dark[y * width + x] = 0;
    for (const [first, last] of columns) for (let x = first; x <= last; x++) for (let y = 0; y < height; y++) if (verticalThickness(x, y) < 3) dark[y * width + x] = 0;
}

function colorComponents(data: Uint8ClampedArray, width: number, height: number): ColorComponent[] {
    const labels = new Int16Array(width * height).fill(-1);
    for (let i = 0; i < width * height; i++) {
        if (data[i * 4 + 3] < 128) continue;
        const r = data[i * 4]; const g = data[i * 4 + 1]; const b = data[i * 4 + 2];
        const max = Math.max(r, g, b); const min = Math.min(r, g, b);
        const chroma = max - min;
        if (chroma < 18 || chroma / Math.max(1, max) < 0.09 || max < 55 || min > 240) continue;
        const delta = chroma;
        const rawHue = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
        labels[i] = Math.round(((rawHue + 360) % 360) / 24) % 15;
    }
    const visited = new Uint8Array(width * height);
    const bridgeRadius = Math.max(2, Math.min(6, Math.round(Math.min(width, height) * 0.003)));
    const colorOffsets: Array<[number, number]> = [];
    for (let distance = 1; distance <= bridgeRadius; distance++) colorOffsets.push([-distance, 0], [distance, 0], [0, -distance], [0, distance], [-distance, -distance], [distance, -distance], [-distance, distance], [distance, distance]);
    const minimumFilled = Math.max(12, Math.round(width * height * 0.00035));
    const minimumOutline = Math.max(16, Math.round(width * height * 0.00008));
    const result: ColorComponent[] = [];
    for (let seed = 0; seed < labels.length; seed++) {
        if (labels[seed] < 0 || visited[seed]) continue;
        const label = labels[seed]; const queue = [seed]; visited[seed] = 1;
        let head = 0; let count = 0; let minX = width; let minY = height; let maxX = 0; let maxY = 0; let red = 0; let green = 0; let blue = 0;
        while (head < queue.length) {
            const index = queue[head++]; const x = index % width; const y = Math.floor(index / width);
            count++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
            red += data[index * 4]; green += data[index * 4 + 1]; blue += data[index * 4 + 2];
            for (const [dx, dy] of colorOffsets) {
                const adjacentX = x + dx; const adjacentY = y + dy;
                if (adjacentX < 0 || adjacentX >= width || adjacentY < 0 || adjacentY >= height) continue;
                const adjacent = adjacentY * width + adjacentX;
                const adjacentLabel = labels[adjacent]; const hueDistance = Math.min(Math.abs(adjacentLabel - label), 15 - Math.abs(adjacentLabel - label));
                if (visited[adjacent] || adjacentLabel < 0 || hueDistance > 1) continue;
                visited[adjacent] = 1; queue.push(adjacent);
            }
        }
        const componentWidth = maxX - minX + 1; const componentHeight = maxY - minY + 1;
        if (componentWidth >= 3 && componentHeight >= 3) {
            const fill = count / (componentWidth * componentHeight); const edgeBand = Math.max(1, Math.min(8, Math.round(Math.min(componentWidth, componentHeight) * 0.12)));
            const top = new Set<number>(); const bottom = new Set<number>(); const left = new Set<number>(); const right = new Set<number>();
            for (const index of queue) { const x = index % width; const y = Math.floor(index / width); if (y <= minY + edgeBand) top.add(x); if (y >= maxY - edgeBand) bottom.add(x); if (x <= minX + edgeBand) left.add(y); if (x >= maxX - edgeBand) right.add(y); }
            const outlineCoverage = Math.min(top.size / componentWidth, bottom.size / componentWidth, left.size / componentHeight, right.size / componentHeight);
            const style = fill >= 0.35 ? 'filled' : 'outline'; const imageCoverage = componentWidth * componentHeight / (width * height);
            const minimumFilledSide = Math.max(3, Math.round(Math.min(width, height) * 0.008));
            const accepted = imageCoverage < 0.7 && (style === 'filled' ? count >= minimumFilled && Math.min(componentWidth, componentHeight) >= minimumFilledSide : count >= minimumOutline && outlineCoverage >= 0.35);
            if (accepted) result.push({ id: `color-${result.length + 1}`, bounds: { x: minX, y: minY, width: componentWidth, height: componentHeight }, colorHex: hex(red / count, green / count, blue / count), pixelCount: count, confidence: Math.min(0.98, style === 'filled' ? 0.55 + fill * 0.4 : 0.55 + outlineCoverage * 0.4), style });
        }
    }
    return result.sort((a, b) => b.pixelCount - a.pixelCount).slice(0, 300);
}

export function analyzePixels(data: Uint8ClampedArray, width: number, height: number): ImageObservations {
    if (data.length !== width * height * 4 || width < 1 || height < 1) throw new Error('Invalid RGBA image data.');
    const components = colorComponents(data, width, height);
    const dark = new Uint8Array(width * height);
    const threshold = luminanceThreshold(data);
    for (let i = 0; i < dark.length; i++) {
        const alpha = data[i * 4 + 3];
        const luminance = data[i * 4] * 0.2126 + data[i * 4 + 1] * 0.7152 + data[i * 4 + 2] * 0.0722;
        dark[i] = alpha >= 128 && luminance < threshold ? 1 : 0;
    }
    maskColoredOutlines(dark, components, width, height);
    suppressGridLines(dark, width, height);
    return { version: 1, widthPx: width, heightPx: height, wallSegments: wallSegments(dark, width, height), colorComponents: components };
}
