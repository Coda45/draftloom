import type { ColorComponent, ImageObservations, PixelSegment } from './types';

function hex(r: number, g: number, b: number): string {
    return `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function bands(counts: Uint32Array, threshold: number): Array<[number, number]> {
    const result: Array<[number, number]> = [];
    let start = -1;
    for (let i = 0; i <= counts.length; i++) {
        if (i < counts.length && counts[i] >= threshold) {
            if (start < 0) start = i;
        } else if (start >= 0) {
            result.push([start, i - 1]);
            start = -1;
        }
    }
    return result;
}

function wallSegments(dark: Uint8Array, width: number, height: number): PixelSegment[] {
    const rows = new Uint32Array(height);
    const columns = new Uint32Array(width);
    const rowSpans: Array<[number, number]> = Array.from({ length: height }, () => [0, -1]);
    const columnSpans: Array<[number, number]> = Array.from({ length: width }, () => [0, -1]);
    const longest = (length: number, at: (index: number) => boolean): [number, number] => { let best: [number, number] = [0, -1]; let start = -1; for (let i = 0; i <= length; i++) { if (i < length && at(i)) { if (start < 0) start = i; } else if (start >= 0) { if (i - start > best[1] - best[0] + 1) best = [start, i - 1]; start = -1; } } return best; };
    for (let y = 0; y < height; y++) { rowSpans[y] = longest(width, (x) => Boolean(dark[y * width + x])); rows[y] = rowSpans[y][1] - rowSpans[y][0] + 1; }
    for (let x = 0; x < width; x++) { columnSpans[x] = longest(height, (y) => Boolean(dark[y * width + x])); columns[x] = columnSpans[x][1] - columnSpans[x][0] + 1; }
    const segments: PixelSegment[] = [];
    for (const [first, last] of bands(rows, Math.max(8, Math.round(width * 0.18)))) {
        const y = (first + last) / 2;
        let min = width; let max = -1;
        for (let row = first; row <= last; row++) if (rowSpans[row][1] - rowSpans[row][0] > max - min) [min, max] = rowSpans[row];
        if (max - min >= width * 0.15) segments.push({ id: `wall-h-${segments.length + 1}`, start: [min, y], end: [max, y], confidence: Math.min(0.98, 0.65 + (max - min) / width * 0.3) });
    }
    for (const [first, last] of bands(columns, Math.max(8, Math.round(height * 0.18)))) {
        const x = (first + last) / 2;
        let min = height; let max = -1;
        for (let column = first; column <= last; column++) if (columnSpans[column][1] - columnSpans[column][0] > max - min) [min, max] = columnSpans[column];
        if (max - min >= height * 0.15) segments.push({ id: `wall-v-${segments.length + 1}`, start: [x, min], end: [x, max], confidence: Math.min(0.98, 0.65 + (max - min) / height * 0.3) });
    }
    return segments.slice(0, 200);
}

function colorComponents(data: Uint8ClampedArray, width: number, height: number): ColorComponent[] {
    const labels = new Int16Array(width * height).fill(-1);
    for (let i = 0; i < width * height; i++) {
        if (data[i * 4 + 3] < 128) continue;
        const r = data[i * 4]; const g = data[i * 4 + 1]; const b = data[i * 4 + 2];
        const max = Math.max(r, g, b); const min = Math.min(r, g, b);
        if (max - min < 45 || max < 70 || min > 225) continue;
        const delta = max - min;
        const rawHue = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
        labels[i] = Math.round(((rawHue + 360) % 360) / 24) % 15;
    }
    const visited = new Uint8Array(width * height);
    const minimum = Math.max(12, Math.round(width * height * 0.00035));
    const result: ColorComponent[] = [];
    for (let seed = 0; seed < labels.length; seed++) {
        if (labels[seed] < 0 || visited[seed]) continue;
        const label = labels[seed]; const queue = [seed]; visited[seed] = 1;
        let head = 0; let count = 0; let minX = width; let minY = height; let maxX = 0; let maxY = 0; let red = 0; let green = 0; let blue = 0;
        while (head < queue.length) {
            const index = queue[head++]; const x = index % width; const y = Math.floor(index / width);
            count++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
            red += data[index * 4]; green += data[index * 4 + 1]; blue += data[index * 4 + 2];
            for (const adjacent of [index - 1, index + 1, index - width, index + width]) {
                if (adjacent < 0 || adjacent >= labels.length || visited[adjacent] || labels[adjacent] !== label) continue;
                if (Math.abs((adjacent % width) - x) > 1) continue;
                visited[adjacent] = 1; queue.push(adjacent);
            }
        }
        if (count >= minimum && maxX - minX >= 2 && maxY - minY >= 2) {
            const fill = count / ((maxX - minX + 1) * (maxY - minY + 1));
            result.push({ id: `color-${result.length + 1}`, bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, colorHex: hex(red / count, green / count, blue / count), pixelCount: count, confidence: Math.min(0.98, 0.55 + fill * 0.4) });
        }
    }
    return result.sort((a, b) => b.pixelCount - a.pixelCount).slice(0, 300);
}

export function analyzePixels(data: Uint8ClampedArray, width: number, height: number): ImageObservations {
    if (data.length !== width * height * 4 || width < 1 || height < 1) throw new Error('Invalid RGBA image data.');
    const dark = new Uint8Array(width * height);
    for (let i = 0; i < dark.length; i++) {
        const alpha = data[i * 4 + 3];
        const luminance = data[i * 4] * 0.2126 + data[i * 4 + 1] * 0.7152 + data[i * 4 + 2] * 0.0722;
        dark[i] = alpha >= 128 && luminance < 95 ? 1 : 0;
    }
    return { version: 1, widthPx: width, heightPx: height, wallSegments: wallSegments(dark, width, height), colorComponents: colorComponents(data, width, height) };
}
