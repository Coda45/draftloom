// Canonical Draftloom scene schema. This file is the scene contract shared by
// the editor, renderer, persistence, export, and reconstruction import.
//
// World conventions (binding):
// - Right-handed, Y-up, meters, radians.
// - The ground plane is X/Z. 2D points are written [x, z].
// - Viewed from above (looking down -Y) with +X to the right, +Z points DOWN
//   the screen. The 2D editor maps world X -> SVG x and world Z -> SVG y.
// - Yaw is rotation about +Y using the right-hand rule. Positive yaw turns +X
//   toward -Z, which appears counter-clockwise in the top-down view.
// - Box `position` is the BOTTOM CENTER of the box. Dimensions are
//   [widthX, heightY, depthZ] measured in the box's local (unrotated) frame.

export const SCENE_SCHEMA_VERSION = 1 as const;

/** A ground-plane point [x, z] in meters. */
export type Vec2 = [number, number];

/** A world point [x, y, z] in meters. */
export type Vec3 = [number, number, number];

/** Box dimensions [widthX, heightY, depthZ] in meters. */
export type Dimensions = [number, number, number];

/** A 2x3 affine matrix [a, b, c, d, e, f] mapping image pixels to world XZ:
 *  x = a*u + b*v + c, z = d*u + e*v + f, where (u, v) are pixel coordinates
 *  with the origin at the image's top-left corner and v pointing down. */
export type AffineMatrix2D = [number, number, number, number, number, number];

export type SnapAngleMode = 'free' | 15 | 45 | 90;

export interface SceneSettings {
    /** Grid spacing used for display and optional grid snapping. */
    gridSizeM: number;
    gridSnap: boolean;
    /** Allowed angle increment for wall drawing; 'free' disables snapping. */
    snapAngle: SnapAngleMode;
    /** Snap only when the drawn angle is within this tolerance of an increment. */
    snapToleranceDeg: number;
}

export type ObjectOrigin = 'manual' | 'reconstructed' | 'packing' | 'imported';

/** Where a piece of geometry came from and how certain it is. */
export interface Provenance {
    origin: ObjectOrigin;
    /** 0..1 confidence reported by reconstruction, when known. */
    confidence?: number;
    /** True when the geometry was inferred rather than directly observed. */
    inferred?: boolean;
    /** Optional source-image polygon in pixels that produced this object. */
    sourcePolygonPx?: Vec2[];
    /** Free-form note, e.g. the legend label that was read. */
    note?: string;
}

export interface ObjectDefinition {
    id: string;
    name: string;
    /** Lowercase or uppercase #rrggbb. */
    color: string;
    defaultDimensions: Dimensions;
    /** Optional legend label or category the user drew (e.g. "blue = rack"). */
    category?: string;
}

export interface BoxInstance {
    kind: 'box';
    id: string;
    definitionId: string;
    /** Optional per-instance display name; defaults to the definition name. */
    name?: string;
    /** Bottom-center position in world meters. */
    position: Vec3;
    /** Rotation about +Y in radians. */
    yaw: number;
    /** When present, replaces the definition's default dimensions. */
    dimensionsOverride?: Dimensions;
    provenance?: Provenance;
}

export interface WallSegment {
    kind: 'wall';
    id: string;
    name?: string;
    /** Ground-plane centerline endpoints. */
    start: Vec2;
    end: Vec2;
    heightM: number;
    thicknessM: number;
    color?: string;
    provenance?: Provenance;
}

export interface Region {
    kind: 'region';
    id: string;
    name: string;
    /** Simple polygon on the ground plane; the closing point is NOT repeated. */
    polygon: Vec2[];
    color?: string;
    provenance?: Provenance;
}

export type SceneObject = BoxInstance | WallSegment | Region;
export type SceneObjectKind = SceneObject['kind'];

export type SourceKind = 'top-down' | 'isometric' | 'unknown';

export interface SourceCalibration {
    pixelToWorld: AffineMatrix2D;
    /** 'reconstructed' when supplied by import, 'manual' when user-aligned. */
    method: 'reconstructed' | 'manual';
}

/** Reference to the source image a scene was built from. */
export interface SourceReference {
    kind: SourceKind;
    /** Key of the image Blob in local IndexedDB storage, when stored. */
    imageKey?: string;
    fileName?: string;
    mimeType?: string;
    widthPx?: number;
    heightPx?: number;
    /** Absent means the overlay is uncalibrated. */
    calibration?: SourceCalibration;
}

export interface SceneDocument {
    schemaVersion: typeof SCENE_SCHEMA_VERSION;
    id: string;
    name: string;
    units: 'meters';
    /** ISO-8601 timestamps. */
    createdAt: string;
    updatedAt: string;
    settings: SceneSettings;
    definitions: ObjectDefinition[];
    objects: SceneObject[];
    source?: SourceReference;
}

export const DEFAULT_SETTINGS: SceneSettings = {
    gridSizeM: 0.5,
    gridSnap: false,
    snapAngle: 90,
    snapToleranceDeg: 8,
};

/** Upper bound accepted by validation to reject runaway imports. */
export const MAX_SCENE_OBJECTS = 5000;
export const MAX_DEFINITIONS = 500;
export const MAX_POLYGON_VERTICES = 1000;
