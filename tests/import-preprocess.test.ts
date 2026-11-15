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
});
