// Portable .draftloom.json project files. Lossless for all native fields.
import type { ReconstructionResult } from '../shared/reconstruction-contract';
import type { SceneDocument } from '../scene/schema';
import { validateScene } from '../scene/validate';

export const NATIVE_EXTENSION = '.draftloom.json';

export function serializeScene(scene: SceneDocument): string {
    return JSON.stringify(scene, null, 2);
}

export type ParsedProjectFile =
    | { ok: true; kind: 'scene'; scene: SceneDocument }
    | { ok: true; kind: 'reconstruction'; result: ReconstructionResult }
    | { ok: false; errors: string[] };

/** Parses a native project file, or a saved ReconstructionResult JSON (useful for testing imports). */
export function parseProjectFile(text: string): ParsedProjectFile {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch (err) {
        return { ok: false, errors: [`Not valid JSON: ${err instanceof Error ? err.message : String(err)}`] };
    }
    if (typeof data === 'object' && data !== null && 'contractVersion' in data && 'scene' in data) {
        const r = data as { contractVersion: unknown; scene: unknown; issues?: unknown };
        if (r.contractVersion !== 1) return { ok: false, errors: [`Unsupported reconstruction contractVersion ${JSON.stringify(r.contractVersion)}`] };
        const v = validateScene(r.scene);
        if (!v.ok) return { ok: false, errors: v.errors.map((e) => `scene.${e}`) };
        const issues = Array.isArray(r.issues) ? (r.issues as ReconstructionResult['issues']) : [];
        return { ok: true, kind: 'reconstruction', result: { contractVersion: 1, scene: v.scene, issues } };
    }
    const v = validateScene(data);
    if (!v.ok) return { ok: false, errors: v.errors };
    return { ok: true, kind: 'scene', scene: v.scene };
}

export function safeFileName(name: string): string {
    const cleaned = name.trim().replace(/[^a-zA-Z0-9-_ ]+/g, '').replace(/\s+/g, '-').toLowerCase();
    return cleaned || 'draftloom-project';
}

/** Triggers a browser download. Returns false if the browser refused. */
export function downloadBlob(blob: Blob, fileName: string): boolean {
    try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        return true;
    } catch {
        return false;
    }
}
