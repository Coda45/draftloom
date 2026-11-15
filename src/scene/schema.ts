// Canonical Draftloom scene schema shared by editing, rendering, persistence,
// export, and reconstruction. Keep this file aligned with ARCHITECTURE.md.
//
// World conventions:
// - Right-handed, Y-up, meters, radians.
// - The ground plane is X/Z. 2D points are [x, z].
// - Box positions are bottom-center anchors.

export const SCENE_SCHEMA_VERSION = 1 as const;

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Dimensions = [number, number, number];
export type SourceMode = 'floorplan' | 'isometric' | 'orthographic';

export type GeometryProvenance = {
    sourceId?: string;
    method: 'manual' | 'detected' | 'inferred';
    confidence?: number;
    notes?: string[];
};

export type ObjectDefinition = {
    id: string;
    name: string;
    dimensions: Dimensions;
    color: string;
    assetId?: string;
};

export type BoxInstance = {
    id: string;
    kind: 'box';
    definitionId: string;
    name?: string;
    position: Vec3;
    rotationY: number;
    dimensionsOverride?: Dimensions;
    provenance?: GeometryProvenance;
};

export type WallSegment = {
    id: string;
    kind: 'wall';
    name?: string;
    start: Vec2;
    end: Vec2;
    baseY: number;
    height: number;
    thickness: number;
    provenance?: GeometryProvenance;
};

export type Region = {
    id: string;
    kind: 'region';
    name: string;
    polygon: Vec2[];
    provenance?: GeometryProvenance;
};

export type SceneObject = BoxInstance | WallSegment | Region;
export type SceneObjectKind = SceneObject['kind'];

export type SourceReference = {
    id: string;
    name: string;
    mode: SourceMode;
    imageKey?: string;
    mimeType?: string;
    widthPx?: number;
    heightPx?: number;
    pixelToWorldXZ?: [number, number, number, number, number, number];
    calibrationMethod?: 'manual' | 'detected' | 'inferred';
    notes?: string[];
};

export type SceneSettings = {
    displayUnit: 'm' | 'cm' | 'ft' | 'in';
    gridSizeM: number;
    gridSnap: boolean;
    snapAngleDeg: 90 | 45 | 15 | 0;
    snapToleranceDeg: number;
};

export type SceneDocument = {
    schemaVersion: 1;
    id: string;
    name: string;
    units: 'm';
    upAxis: 'Y';
    definitions: Record<string, ObjectDefinition>;
    objects: SceneObject[];
    sources: SourceReference[];
    settings: SceneSettings;
    createdAt?: string;
    updatedAt: string;
};

export const DEFAULT_SETTINGS: SceneSettings = {
    displayUnit: 'm',
    gridSizeM: 0.5,
    gridSnap: false,
    snapAngleDeg: 90,
    snapToleranceDeg: 8,
};

export const MAX_SCENE_OBJECTS = 5000;
export const MAX_DEFINITIONS = 500;
export const MAX_POLYGON_VERTICES = 1000;
