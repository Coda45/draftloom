export type PixelPoint = [number, number];

export interface PixelSegment {
    id: string;
    start: PixelPoint;
    end: PixelPoint;
    confidence: number;
}

export interface ColorComponent {
    id: string;
    bounds: { x: number; y: number; width: number; height: number };
    colorHex: string;
    pixelCount: number;
    confidence: number;
}

export interface ImageObservations {
    version: 1;
    widthPx: number;
    heightPx: number;
    wallSegments: PixelSegment[];
    colorComponents: ColorComponent[];
}

export interface PreprocessedImage {
    blob: Blob;
    observations: ImageObservations;
    previewUrl: string;
}
