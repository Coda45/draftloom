// Frozen cross-team contract between the reconstruction side (src/import,
// server) and the editor side. Change only by agreement between both developers.
//
// The reconstruction service returns a complete, canonical SceneDocument (see
// src/scene/schema.ts for world conventions) plus human-readable issues. The
// editor validates it, replaces its document, and shows the issues.
import type { SceneDocument } from '../scene/schema';

export const RECONSTRUCTION_CONTRACT_VERSION = 1 as const;

export type ReconstructionIssueSeverity = 'info' | 'warning' | 'error';

export interface ReconstructionIssue {
    /** Unique within one result. */
    id: string;
    severity: ReconstructionIssueSeverity;
    /** Stable machine-readable code, e.g. "legend-unreadable", "low-confidence-wall". */
    code: string;
    /** Message shown to the user as-is. */
    message: string;
    /** Scene object IDs the issue refers to, if any. */
    objectIds?: string[];
}

export interface ReconstructionResult {
    contractVersion: typeof RECONSTRUCTION_CONTRACT_VERSION;
    /** Must pass validateScene. Objects should carry provenance.origin = 'reconstructed'. */
    scene: SceneDocument;
    issues: ReconstructionIssue[];
}

/** Callbacks the editor passes to the import UI owned by the reconstruction side. */
export interface ReconstructionImportHandlers {
    /**
     * Called with a finished result and, optionally, the source image. When an
     * image is provided, the editor stores it locally under
     * `result.scene.source.imageKey` (generating a key if absent) for the overlay.
     */
    onReconstruction(result: ReconstructionResult, sourceImage?: Blob): Promise<void>;
}
