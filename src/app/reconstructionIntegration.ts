// Editor-side entry point for reconstruction results produced by the import
// module (src/import, owned by the reconstruction side). This is the only
// place the editor accepts reconstructed scenes.
import { RECONSTRUCTION_CONTRACT_VERSION, type ReconstructionIssue, type ReconstructionResult } from '../shared/reconstruction-contract';
import { newId } from '../scene/ids';
import type { ProjectStorage } from '../scene/persistence';
import type { SceneStore } from '../scene/store';
import { validateScene } from '../scene/validate';

export type ApplyOutcome = { ok: true; issues: ReconstructionIssue[] } | { ok: false; errors: string[] };

/**
 * Validates result.scene, stores the optional source image locally under
 * the primary source's imageKey, and replaces the current document.
 */
export async function applyReconstruction(
    store: SceneStore,
    storage: ProjectStorage | null,
    result: ReconstructionResult,
    sourceImage?: Blob,
): Promise<ApplyOutcome> {
    if (result.contractVersion !== RECONSTRUCTION_CONTRACT_VERSION) {
        return { ok: false, errors: [`Unsupported reconstruction contractVersion ${String(result.contractVersion)}`] };
    }
    const v = validateScene(result.scene);
    if (!v.ok) return { ok: false, errors: v.errors };
    let scene = v.scene;
    const issues = Array.isArray(result.issues) ? [...result.issues] : [];

    if (sourceImage) {
        const primarySource = scene.sources[0];
        const imageKey = primarySource?.imageKey ?? newId('img');
        if (storage) {
            try {
                await storage.putBlob(imageKey, sourceImage);
            } catch (err) {
                issues.push({
                    id: newId('issue'),
                    severity: 'warning',
                    code: 'image-not-stored',
                    message: `The source image could not be saved locally (${err instanceof Error ? err.message : String(err)}); the overlay will be unavailable after reload.`,
                });
            }
        }
        const source = primarySource ?? {
            id: newId('source'),
            name: 'Imported sketch',
            mode: result.modeUsed,
        };
        scene = {
            ...scene,
            sources: [{ ...source, imageKey, mimeType: source.mimeType ?? (sourceImage.type || undefined) }, ...scene.sources.slice(1)],
        };
    }

    store.replaceScene(scene);
    return { ok: true, issues };
}
