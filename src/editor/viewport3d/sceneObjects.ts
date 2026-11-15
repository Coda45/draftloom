// Builds Three.js objects from canonical scene objects. Shared by the live
// viewport and GLB export so both use identical geometry and transforms.
import * as THREE from 'three';
import { boxDimensions, wallLength, yawFromDirection } from '../../scene/geometry';
import type { BoxInstance, ObjectDefinition, Region, SceneObject, WallSegment } from '../../scene/schema';

export interface BuildOptions {
    /** Viewport-only styling: show inferred / low-confidence geometry translucent. */
    showUncertainty: boolean;
}

export interface DraftloomUserData {
    draftloomId: string;
    kind: SceneObject['kind'];
    definitionId?: string;
}

const DEFAULT_WALL_COLOR = '#d8d4cc';
const DEFAULT_REGION_COLOR = '#6aa84f';

function isUncertain(o: SceneObject): boolean {
    const p = o.provenance;
    return !!p && (p.inferred === true || (p.confidence !== undefined && p.confidence < 0.6));
}

function solidMaterial(color: string, uncertain: boolean): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color,
        roughness: 0.8,
        metalness: 0.05,
        transparent: uncertain,
        opacity: uncertain ? 0.45 : 1,
    });
}

/** Cache key covering every field that affects an object's mesh. */
export function objectKey(o: SceneObject, definitions: ObjectDefinition[]): string {
    if (o.kind === 'box') {
        const def = definitions.find((d) => d.id === o.definitionId);
        return JSON.stringify([o, def?.color, boxDimensions(o, definitions)]);
    }
    return JSON.stringify(o);
}

function buildBox(o: BoxInstance, definitions: ObjectDefinition[], opts: BuildOptions): THREE.Object3D {
    const def = definitions.find((d) => d.id === o.definitionId);
    const [w, h, d] = boxDimensions(o, definitions);
    // Bottom-centered geometry so the node position is the box's base.
    const geom = new THREE.BoxGeometry(w, h, d);
    geom.translate(0, h / 2, 0);
    const mesh = new THREE.Mesh(geom, solidMaterial(def?.color ?? '#999999', opts.showUncertainty && isUncertain(o)));
    mesh.position.set(o.position[0], o.position[1], o.position[2]);
    mesh.rotation.y = o.yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

function buildWall(o: WallSegment, opts: BuildOptions): THREE.Object3D | null {
    const len = wallLength(o);
    if (len < 1e-6) return null;
    const geom = new THREE.BoxGeometry(len, o.heightM, o.thicknessM);
    geom.translate(0, o.heightM / 2, 0);
    const mesh = new THREE.Mesh(geom, solidMaterial(o.color ?? DEFAULT_WALL_COLOR, opts.showUncertainty && isUncertain(o)));
    mesh.position.set((o.start[0] + o.end[0]) / 2, 0, (o.start[1] + o.end[1]) / 2);
    mesh.rotation.y = yawFromDirection(o.end[0] - o.start[0], o.end[1] - o.start[1]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

function buildRegion(o: Region): THREE.Object3D {
    // Shape lives in local XY; rotating -90° about X maps (x, y) -> (x, 0, -y), so feed y = -z.
    const shape = new THREE.Shape(o.polygon.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geom = new THREE.ShapeGeometry(shape);
    geom.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
        color: o.color ?? DEFAULT_REGION_COLOR,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geom, mat);
    // Lift slightly to avoid z-fighting with the ground grid.
    mesh.position.y = 0.004;
    mesh.renderOrder = -1;
    return mesh;
}

export function objectDisplayName(o: SceneObject, definitions: ObjectDefinition[]): string {
    if (o.name) return o.name;
    if (o.kind === 'box') return definitions.find((d) => d.id === o.definitionId)?.name ?? 'Box';
    if (o.kind === 'wall') return 'Wall';
    return 'Region';
}

export function buildObject(o: SceneObject, definitions: ObjectDefinition[], opts: BuildOptions): THREE.Object3D | null {
    let obj: THREE.Object3D | null;
    if (o.kind === 'box') obj = buildBox(o, definitions, opts);
    else if (o.kind === 'wall') obj = buildWall(o, opts);
    else obj = buildRegion(o);
    if (!obj) return null;
    obj.name = objectDisplayName(o, definitions);
    const data: DraftloomUserData = { draftloomId: o.id, kind: o.kind };
    if (o.kind === 'box') data.definitionId = o.definitionId;
    obj.userData = data;
    return obj;
}

/** Disposes geometries and materials owned by an object tree. */
export function disposeObject(obj: THREE.Object3D): void {
    obj.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
    });
}
