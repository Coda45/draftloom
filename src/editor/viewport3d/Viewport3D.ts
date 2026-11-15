// Imperative Three.js viewport. One renderer, scene, and camera pair per
// workspace lifetime; React only mounts it once and forwards scene changes.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SceneDocument } from '../../scene/schema';
import { buildObject, disposeObject, objectKey, type DraftloomUserData } from './sceneObjects';

export type Projection = 'perspective' | 'orthographic';

export interface Viewport3DCallbacks {
    onSelect(id: string | null): void;
}

interface Entry {
    key: string;
    object: THREE.Object3D;
}

const SELECT_COLOR = 0xffb020;
const CLICK_TOLERANCE_PX = 4;
const FOV = 50;

export class Viewport3D {
    readonly renderer: THREE.WebGLRenderer;
    private readonly scene = new THREE.Scene();
    private readonly content = new THREE.Group();
    private readonly perspective: THREE.PerspectiveCamera;
    private readonly orthographic: THREE.OrthographicCamera;
    private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
    private readonly controls: OrbitControls;
    private readonly entries = new Map<string, Entry>();
    private readonly raycaster = new THREE.Raycaster();
    private readonly resizeObserver: ResizeObserver;
    private selectionOutline: THREE.LineSegments | null = null;
    private selectedId: string | null = null;
    private active = true;
    private frameRequested = false;
    private needsRender = true;
    private pointerDown: { x: number; y: number } | null = null;
    private disposed = false;
    private hasFramed = false;

    constructor(private readonly container: HTMLElement, private readonly callbacks: Viewport3DCallbacks) {
        // Throws if WebGL is unavailable; the React wrapper reports it.
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x1b1d22);
        this.renderer.domElement.className = 'viewport3d-canvas';
        container.appendChild(this.renderer.domElement);

        this.perspective = new THREE.PerspectiveCamera(FOV, 1, 0.05, 2000);
        this.perspective.position.set(10, 9, 14);
        this.orthographic = new THREE.OrthographicCamera(-10, 10, 10, -10, -1000, 2000);
        this.camera = this.perspective;

        this.controls = new OrbitControls(this.perspective, this.renderer.domElement);
        // Blender-like: MMB orbit (Shift+MMB pans), RMB pan, wheel zoom; LMB stays for selection.
        this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
        this.controls.enableDamping = false;
        this.controls.zoomToCursor = true;
        // Tiny polar epsilon avoids the singularity when looking straight down.
        this.controls.minPolarAngle = 0.001;
        this.controls.maxPolarAngle = Math.PI - 0.001;
        this.controls.target.set(4, 0, 3);
        this.controls.addEventListener('change', () => this.requestRender());
        this.controls.update();

        this.buildEnvironment();
        this.scene.add(this.content);

        const el = this.renderer.domElement;
        el.addEventListener('pointerdown', this.onPointerDown);
        el.addEventListener('pointerup', this.onPointerUp);
        el.addEventListener('contextmenu', this.onContextMenu);

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(container);
        this.resize();
    }

    private buildEnvironment(): void {
        const grid = new THREE.GridHelper(60, 60, 0x4a4f5a, 0x2c3038);
        grid.position.y = -0.001;
        this.scene.add(grid);
        const axes = new THREE.AxesHelper(1.5);
        axes.position.y = 0.002;
        this.scene.add(axes);
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f48, 1.6));
        const sun = new THREE.DirectionalLight(0xffffff, 1.8);
        sun.position.set(8, 14, 6);
        this.scene.add(sun);
    }

    /** Reconciles Three objects with the scene. Only changed objects are rebuilt. */
    sync(doc: SceneDocument, selectedId: string | null): void {
        const seen = new Set<string>();
        for (const o of doc.objects) {
            seen.add(o.id);
            const key = objectKey(o, doc.definitions);
            const existing = this.entries.get(o.id);
            if (existing && existing.key === key) continue;
            if (existing) {
                this.content.remove(existing.object);
                disposeObject(existing.object);
                this.entries.delete(o.id);
            }
            const obj = buildObject(o, doc.definitions, { showUncertainty: true });
            if (obj) {
                this.content.add(obj);
                this.entries.set(o.id, { key, object: obj });
            }
        }
        for (const [id, entry] of this.entries) {
            if (!seen.has(id)) {
                this.content.remove(entry.object);
                disposeObject(entry.object);
                this.entries.delete(id);
            }
        }
        this.setSelection(selectedId, true);
        if (!this.hasFramed && this.entries.size > 0) {
            this.hasFramed = true;
            this.frame(null);
        }
        this.requestRender();
    }

    private setSelection(id: string | null, force = false): void {
        if (!force && id === this.selectedId) return;
        this.selectedId = id;
        if (this.selectionOutline) {
            this.selectionOutline.parent?.remove(this.selectionOutline);
            this.selectionOutline.geometry.dispose();
            (this.selectionOutline.material as THREE.Material).dispose();
            this.selectionOutline = null;
        }
        const entry = id ? this.entries.get(id) : undefined;
        const mesh = entry?.object as THREE.Mesh | undefined;
        if (mesh?.geometry) {
            const edges = new THREE.EdgesGeometry(mesh.geometry);
            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: SELECT_COLOR, depthTest: false }));
            line.renderOrder = 10;
            line.raycast = () => {};
            mesh.add(line);
            this.selectionOutline = line;
        }
        this.requestRender();
    }

    /** Pauses rendering while hidden; geometry, camera, and canvas are kept. */
    setActive(active: boolean): void {
        if (this.active === active) return;
        this.active = active;
        if (active) {
            this.resize();
            this.requestRender();
        }
    }

    getProjection(): Projection {
        return this.camera === this.perspective ? 'perspective' : 'orthographic';
    }

    /** Switches cameras, sharing target and approximate framing. Both can orbit. */
    setProjection(p: Projection): void {
        if (p === this.getProjection()) return;
        const target = this.controls.target;
        if (p === 'orthographic') {
            const dist = this.perspective.position.distanceTo(target);
            const halfH = dist * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
            this.orthographic.position.copy(this.perspective.position);
            this.orthographic.quaternion.copy(this.perspective.quaternion);
            this.orthographic.zoom = 1;
            this.orthoHalfHeight = halfH;
            this.camera = this.orthographic;
        } else {
            // Keep the orbit direction; choose a distance that matches the ortho framing.
            const dir = new THREE.Vector3().subVectors(this.orthographic.position, target).normalize();
            const halfH = this.orthoHalfHeight / this.orthographic.zoom;
            const dist = halfH / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
            this.perspective.position.copy(target).addScaledVector(dir, dist);
            this.camera = this.perspective;
        }
        this.controls.object = this.camera;
        this.resize();
        this.controls.update();
        this.requestRender();
    }

    private orthoHalfHeight = 10;

    /** Frames the given object, or the whole scene when id is null. */
    frame(id: string | null): void {
        const box = new THREE.Box3();
        if (id && this.entries.has(id)) box.setFromObject(this.entries.get(id)!.object);
        else box.setFromObject(this.content);
        if (box.isEmpty()) return;
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const radius = Math.max(sphere.radius, 0.5);
        const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
        if (dir.lengthSq() < 1e-9) dir.set(1, 1, 1);
        dir.normalize();
        const dist = radius / Math.sin(THREE.MathUtils.degToRad(FOV / 2)) * 1.1;
        this.controls.target.copy(sphere.center);
        this.perspective.position.copy(sphere.center).addScaledVector(dir, dist);
        this.orthographic.position.copy(sphere.center).addScaledVector(dir, dist);
        this.orthoHalfHeight = radius * 1.1;
        this.orthographic.zoom = 1;
        this.resize();
        this.controls.update();
        this.requestRender();
    }

    private resize(): void {
        const w = Math.max(1, this.container.clientWidth);
        const h = Math.max(1, this.container.clientHeight);
        // Hidden containers report zero size; keep the last good size.
        if (this.container.clientWidth === 0 || this.container.clientHeight === 0) return;
        this.renderer.setSize(w, h, false);
        const aspect = w / h;
        this.perspective.aspect = aspect;
        this.perspective.updateProjectionMatrix();
        const hh = this.orthoHalfHeight;
        this.orthographic.left = -hh * aspect;
        this.orthographic.right = hh * aspect;
        this.orthographic.top = hh;
        this.orthographic.bottom = -hh;
        this.orthographic.updateProjectionMatrix();
        this.requestRender();
    }

    requestRender(): void {
        this.needsRender = true;
        if (!this.active || this.frameRequested || this.disposed) return;
        this.frameRequested = true;
        requestAnimationFrame(() => {
            this.frameRequested = false;
            if (!this.active || this.disposed || !this.needsRender) return;
            this.needsRender = false;
            this.renderer.render(this.scene, this.camera);
        });
    }

    private onContextMenu = (e: Event): void => e.preventDefault();

    private onPointerDown = (e: PointerEvent): void => {
        if (e.button === 0) this.pointerDown = { x: e.clientX, y: e.clientY };
    };

    private onPointerUp = (e: PointerEvent): void => {
        if (e.button !== 0 || !this.pointerDown) return;
        const moved = Math.hypot(e.clientX - this.pointerDown.x, e.clientY - this.pointerDown.y);
        this.pointerDown = null;
        if (moved > CLICK_TOLERANCE_PX) return;
        this.callbacks.onSelect(this.pick(e.clientX, e.clientY));
    };

    /** Raycasts to the canonical object ID; solids win over flat regions. */
    pick(clientX: number, clientY: number): string | null {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
        this.raycaster.setFromCamera(ndc, this.camera);
        const hits = this.raycaster.intersectObjects(this.content.children, true);
        let regionHit: string | null = null;
        for (const hit of hits) {
            let o: THREE.Object3D | null = hit.object;
            while (o && !(o.userData as Partial<DraftloomUserData>).draftloomId) o = o.parent;
            if (!o) continue;
            const data = o.userData as DraftloomUserData;
            if (data.kind === 'region') {
                regionHit ??= data.draftloomId;
                continue;
            }
            return data.draftloomId;
        }
        return regionHit;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.resizeObserver.disconnect();
        const el = this.renderer.domElement;
        el.removeEventListener('pointerdown', this.onPointerDown);
        el.removeEventListener('pointerup', this.onPointerUp);
        el.removeEventListener('contextmenu', this.onContextMenu);
        this.controls.dispose();
        this.setSelection(null, true);
        for (const entry of this.entries.values()) disposeObject(entry.object);
        this.entries.clear();
        this.scene.traverse((o) => disposeObject(o));
        this.renderer.dispose();
        this.renderer.forceContextLoss();
        el.remove();
    }
}
