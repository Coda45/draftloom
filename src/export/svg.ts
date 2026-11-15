// Top-down SVG export generated from world X/Z geometry. One SVG user unit
// equals one meter; width/height attributes carry real-world size in meters.
import { boundsOf, boxFootprint, findDefinition, polygonCentroid, wallFootprint } from '../scene/geometry';
import type { SceneDocument, Vec2 } from '../scene/schema';

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pts(points: Vec2[]): string {
    return points.map(([x, z]) => `${fmt(x)},${fmt(z)}`).join(' ');
}

function fmt(n: number): string {
    return Number(n.toFixed(4)).toString();
}

export interface SvgExportOptions {
    marginM?: number;
    labels?: boolean;
}

export function sceneToSvg(scene: SceneDocument, options: SvgExportOptions = {}): string {
    const margin = options.marginM ?? 0.5;
    const labels = options.labels ?? true;
    const all: Vec2[] = [];
    const regions: string[] = [];
    const walls: string[] = [];
    const boxes: string[] = [];
    const text: string[] = [];
    const fontSize = 0.22;

    for (const o of scene.objects) {
        if (o.kind === 'region') {
            all.push(...o.polygon);
            const color = '#6aa84f';
            regions.push(`    <polygon id="${esc(o.id)}" points="${pts(o.polygon)}" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="0.03" stroke-dasharray="0.15 0.08"/>`);
            if (labels) {
                const [cx, cz] = polygonCentroid(o.polygon);
                text.push(`    <text x="${fmt(cx)}" y="${fmt(cz)}" font-size="${fontSize}" fill="${color}">${esc(o.name)}</text>`);
            }
        } else if (o.kind === 'wall') {
            const fp = wallFootprint(o);
            if (fp.length === 0) continue;
            all.push(...fp);
            walls.push(`    <polygon id="${esc(o.id)}" points="${pts(fp)}" fill="#2b2b2b"/>`);
        } else {
            const fp = boxFootprint(o, scene.definitions);
            all.push(...fp);
            const def = findDefinition(scene, o.definitionId);
            const color = def?.color ?? '#999999';
            boxes.push(`    <polygon id="${esc(o.id)}" points="${pts(fp)}" fill="${color}" fill-opacity="0.55" stroke="${color}" stroke-width="0.02"/>`);
            if (labels) {
                const legacyName = o.provenance?.notes?.find((note) => note.startsWith('displayName:'))?.slice('displayName:'.length).trim();
                const customName = o.name?.trim() || legacyName;
                text.push(`    <text x="${fmt(o.position[0])}" y="${fmt(o.position[2])}" font-size="${fontSize * 0.8}" fill="#1a1a1a">${esc(customName || def?.name || 'Box')}</text>`);
            }
        }
    }

    const b = all.length > 0 ? boundsOf(all) : { minX: 0, minZ: 0, maxX: 1, maxZ: 1 };
    const x = b.minX - margin;
    const z = b.minZ - margin;
    const w = b.maxX - b.minX + margin * 2;
    const h = b.maxZ - b.minZ + margin * 2;

    return [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<!-- Draftloom top-down export. 1 user unit = 1 meter. +X right, +Z down (world X/Z plane). -->`,
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(x)} ${fmt(z)} ${fmt(w)} ${fmt(h)}" width="${fmt(w * 100)}cm" height="${fmt(h * 100)}cm">`,
        `  <title>${esc(scene.name)}</title>`,
        `  <g id="regions">`,
        ...regions,
        `  </g>`,
        `  <g id="walls">`,
        ...walls,
        `  </g>`,
        `  <g id="boxes">`,
        ...boxes,
        `  </g>`,
        labels ? `  <g id="labels" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">` : '',
        ...(labels ? text : []),
        labels ? `  </g>` : '',
        `</svg>`,
        '',
    ]
        .filter((l) => l !== '')
        .join('\n');
}
