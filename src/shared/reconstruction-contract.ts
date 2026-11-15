// Frozen cross-team reconstruction contract from ARCHITECTURE.md. Change only
// by agreement between both developers.
import type { SceneDocument } from '../scene/schema';

export const RECONSTRUCTION_CONTRACT_VERSION = 1 as const;

export type ImportMode = 'auto' | 'floorplan' | 'isometric';

export type ReconstructionIssue = {
    id?: string;
    severity: 'info' | 'warning' | 'error';
    code: string;
    message: string;
    objectId?: string;
    objectIds?: string[];
};

export type ReconstructionResult = {
    contractVersion: typeof RECONSTRUCTION_CONTRACT_VERSION;
    modeUsed: 'floorplan' | 'isometric';
    scene: SceneDocument;
    issues: ReconstructionIssue[];
    requiresScaleConfirmation: boolean;
};

/** Callbacks the editor passes to the import UI owned by Developer B. */
export interface ReconstructionImportHandlers {
    onReconstruction(result: ReconstructionResult, sourceImage?: Blob): Promise<void>;
}
