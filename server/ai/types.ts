import type { ImportMode } from '../../src/shared/reconstruction-contract';

export interface LegendEntry {
    label: string;
    colorHex: string;
    defaultHeightM?: number;
}

export interface NormalizedBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface SketchSemantics {
    mode: 'floorplan' | 'isometric';
    legendEntries: LegendEntry[];
    legendArea?: NormalizedBox;
    metersPerPixel?: number;
    wallHeightM?: number;
    notes: string[];
}

export interface SketchVisionProvider {
    analyzeSketch(input: {
        imageBytes: Uint8Array;
        mimeType: string;
        mode: ImportMode;
        promptContext?: string;
    }): Promise<unknown>;
}
