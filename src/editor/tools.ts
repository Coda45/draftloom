// Editor tool and overlay types shared by the 2D view and the app shell.
import type { AffineMatrix2D } from '../scene/schema';

export type Tool = 'select' | 'wall' | 'box' | 'region' | 'pan';

export const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
    { id: 'select', label: 'Select', key: 'V', hint: 'Click to select, drag to move. Drag handles to edit wall ends and region vertices.' },
    { id: 'wall', label: 'Wall', key: 'W', hint: 'Click to start, click to place each corner. Esc or right-click to finish.' },
    { id: 'box', label: 'Box', key: 'B', hint: 'Click to place the active definition.' },
    { id: 'region', label: 'Region', key: 'R', hint: 'Click to add vertices; click the first vertex or press Enter to close. Esc cancels.' },
    { id: 'pan', label: 'Pan', key: 'H', hint: 'Drag to pan. Middle mouse or Space+drag pans with any tool.' },
];

export interface OverlayImage {
    url: string;
    widthPx: number;
    heightPx: number;
    /** Pixel -> world XZ affine transform. */
    matrix: AffineMatrix2D;
    calibrated: boolean;
    visible: boolean;
    opacity: number;
}

export const DEFAULT_WALL_HEIGHT_M = 2.7;
export const DEFAULT_WALL_THICKNESS_M = 0.15;
