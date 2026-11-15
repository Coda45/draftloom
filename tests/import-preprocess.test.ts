import { describe, expect, it } from 'vitest';
import { analyzePixels } from '../src/import/preprocess/analyzePixels';

function drawing(width: number, height: number): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const paint = (x0: number, y0: number, x1: number, y1: number, color: [number, number, number]) => {
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * width + x) * 4; data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; }
    };
    paint(5, 8, width - 5, 11, [0, 0, 0]); paint(7, 5, 10, height - 5, [0, 0, 0]);
    paint(20, 20, 38, 32, [20, 80, 220]); paint(50, 35, 68, 50, [230, 180, 20]);
    return data;
}

function photographedTabletDrawing(): Uint8ClampedArray {
    const width = 240; const height = 320; const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const paint = (x0: number, y0: number, x1: number, y1: number, color: [number, number, number]) => {
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * width + x) * 4; data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; }
    };
    const line = (x0: number, y0: number, x1: number, y1: number, thickness: number) => {
        const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        for (let step = 0; step <= steps; step++) { const x = Math.round(x0 + (x1 - x0) * step / steps); const y = Math.round(y0 + (y1 - y0) * step / steps); paint(x - thickness, y - thickness, x + thickness + 1, y + thickness + 1, [15, 15, 15]); }
    };
    line(28, 58, 210, 63, 2); line(28, 58, 34, 294, 2); line(210, 63, 216, 294, 2); line(34, 294, 216, 294, 2);
    paint(207, 171, 214, 173, [255, 255, 255]);
    paint(48, 92, 87, 190, [10, 10, 10]); paint(53, 97, 82, 185, [25, 70, 215]);
    paint(47, 202, 91, 278, [10, 10, 10]); paint(52, 207, 86, 273, [25, 70, 215]);
    paint(236, 0, 240, 320, [5, 5, 5]);
    return data;
}

function coloredOutlineDrawing(): Uint8ClampedArray {
    const width = 200; const height = 140; const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const paint = (x0: number, y0: number, x1: number, y1: number, color: [number, number, number]) => {
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * width + x) * 4; data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; }
    };
    const outline = (x: number, y: number, boxWidth: number, boxHeight: number, color: [number, number, number]) => {
        paint(x, y, x + boxWidth, y + 3, color); paint(x, y + boxHeight - 3, x + boxWidth, y + boxHeight, color);
        paint(x, y, x + 3, y + boxHeight, color); paint(x + boxWidth - 3, y, x + boxWidth, y + boxHeight, color);
        paint(x + Math.floor(boxWidth / 2), y, x + Math.floor(boxWidth / 2) + 1, y + 3, [255, 255, 255]);
    };
    outline(20, 20, 45, 70, [25, 70, 220]); outline(105, 35, 65, 45, [225, 175, 20]);
    return data;
}

function unevenlyLitDrawing(): Uint8ClampedArray {
    const width = 180; const height = 120; const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const paint = (x0: number, y0: number, x1: number, y1: number, value: number) => {
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * width + x) * 4; data[i] = value; data[i + 1] = value; data[i + 2] = value; }
    };
    paint(0, 0, width, height, 150); paint(0, 78, width, 100, 80);
    paint(15, 18, 165, 21, 25); paint(18, 15, 21, 110, 25);
    return data;
}

function graphPaperDrawing(): Uint8ClampedArray {
    const width = 240; const height = 320; const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const paint = (x0: number, y0: number, x1: number, y1: number, color: [number, number, number]) => {
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * width + x) * 4; data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; }
    };
    for (let x = 0; x < width; x += 20) paint(x, 0, x + 1, height, [72, 72, 72]);
    for (let y = 0; y < height; y += 20) paint(0, y, width, y + 1, [72, 72, 72]);
    paint(38, 58, 203, 62, [12, 12, 12]); paint(38, 278, 203, 282, [12, 12, 12]);
    paint(38, 58, 42, 282, [12, 12, 12]); paint(199, 58, 203, 282, [12, 12, 12]);
    paint(60, 90, 63, 170, [155, 180, 195]); paint(60, 90, 105, 93, [150, 175, 205]); paint(102, 90, 105, 170, [145, 180, 200]); paint(60, 167, 105, 170, [155, 185, 205]);
    paint(130, 190, 133, 235, [220, 210, 25]); paint(130, 190, 180, 193, [220, 210, 25]); paint(177, 190, 180, 235, [220, 210, 25]); paint(130, 232, 180, 235, [220, 210, 25]);
    return data;
}

describe('deterministic pixel analysis', () => {
    it('finds long walls and distinct colored rectangles', () => {
        const result = analyzePixels(drawing(100, 70), 100, 70);
        expect(result.wallSegments.length).toBeGreaterThanOrEqual(2);
        expect(result.colorComponents.map((item) => item.colorHex)).toEqual(expect.arrayContaining(['#1450DC', '#E6B414']));
    });

    it('does not invent geometry in a blank drawing', () => {
        const pixels = new Uint8ClampedArray(80 * 60 * 4).fill(255);
        const result = analyzePixels(pixels, 80, 60);
        expect(result.wallSegments).toEqual([]);
        expect(result.colorComponents).toEqual([]);
    });

    it('ignores colored-object outlines and a photographed tablet bezel', () => {
        const result = analyzePixels(photographedTabletDrawing(), 240, 320);
        const horizontal = result.wallSegments.filter((segment) => segment.start[1] === segment.end[1]);
        const vertical = result.wallSegments.filter((segment) => segment.start[0] === segment.end[0]);
        expect(horizontal).toHaveLength(2); expect(vertical).toHaveLength(2);
        expect(horizontal.every((segment) => segment.end[0] - segment.start[0] > 170)).toBe(true);
        expect(vertical.every((segment) => segment.end[1] - segment.start[1] > 220)).toBe(true);
        expect(vertical.every((segment) => segment.start[0] < 225)).toBe(true);
        expect(result.colorComponents).toHaveLength(2);
    });

    it('recognizes thin colored rectangle outlines without requiring fills', () => {
        const result = analyzePixels(coloredOutlineDrawing(), 200, 140);
        expect(result.colorComponents).toHaveLength(2);
        expect(result.colorComponents.every((component) => component.style === 'outline')).toBe(true);
        expect(result.colorComponents.map((component) => component.colorHex)).toEqual(expect.arrayContaining(['#1946DC', '#E1AF14']));
        expect(result.colorComponents.map((component) => component.bounds)).toEqual(expect.arrayContaining([{ x: 20, y: 20, width: 45, height: 70 }, { x: 105, y: 35, width: 65, height: 45 }]));
    });

    it('uses page exposure to reject broad photographic shadows', () => {
        const result = analyzePixels(unevenlyLitDrawing(), 180, 120);
        expect(result.wallSegments).toHaveLength(2);
        expect(result.wallSegments.every((segment) => segment.start[1] < 75 && segment.end[1] < 115)).toBe(true);
    });

    it('removes periodic graph-paper lines while retaining darker room walls', () => {
        const result = analyzePixels(graphPaperDrawing(), 240, 320);
        expect(result.wallSegments).toHaveLength(4);
        expect(result.colorComponents).toHaveLength(2);
        expect(result.colorComponents.every((component) => component.style === 'outline')).toBe(true);
        expect(result.colorComponents.some((component) => component.colorHex.startsWith('#9'))).toBe(true);
    });
});
