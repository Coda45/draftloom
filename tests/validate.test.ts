import { describe, expect, it } from 'vitest';
import { validateScene } from '../src/scene/validate';
import { sampleScene } from './helpers';

describe('validateScene', () => {
    it('accepts the sample studio', () => {
        const r = validateScene(sampleScene());
        expect(r.ok).toBe(true);
    });

    it('rejects unsupported schema versions', () => {
        const s = { ...sampleScene(), schemaVersion: 2 };
        const r = validateScene(s);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.errors[0]).toMatch(/unsupported version 2/);
    });

    it('rejects NaN, Infinity, and nonpositive dimensions', () => {
        const s = sampleScene() as any;
        s.definitions[0].defaultDimensions = [1, 0, 1];
        s.objects[4].position = [NaN, 0, 0];
        s.objects[0].heightM = Infinity;
        const r = validateScene(s);
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.errors.join('\n')).toMatch(/defaultDimensions\[1\]: must be greater than zero/);
            expect(r.errors.join('\n')).toMatch(/position\[0\]: must be a finite number/);
            expect(r.errors.join('\n')).toMatch(/heightM: must be a finite number/);
        }
    });

    it('rejects missing definitions, duplicate IDs and malformed colors', () => {
        const s = sampleScene() as any;
        s.objects[4].definitionId = 'def-missing';
        s.objects[5].id = s.objects[4].id;
        s.definitions[1].color = 'orange';
        const r = validateScene(s);
        expect(r.ok).toBe(false);
        if (!r.ok) {
            const text = r.errors.join('\n');
            expect(text).toMatch(/missing definition "def-missing"/);
            expect(text).toMatch(/duplicate id "box-desk-1"/);
            expect(text).toMatch(/#rrggbb color/);
        }
    });

    it('rejects self-intersecting and zero-area polygons', () => {
        const bowtie = sampleScene() as any;
        bowtie.objects[7].polygon = [[0, 0], [2, 2], [2, 0], [0, 2]];
        expect(validateScene(bowtie).ok).toBe(false);
        const flat = sampleScene() as any;
        flat.objects[7].polygon = [[0, 0], [1, 0], [2, 0]];
        expect(validateScene(flat).ok).toBe(false);
    });

    it('rejects suspiciously large object counts and unknown kinds', () => {
        const big = sampleScene() as any;
        big.objects = Array.from({ length: 5001 }, (_, i) => ({ ...big.objects[0], id: `w${i}` }));
        const r = validateScene(big);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.errors[0]).toMatch(/suspiciously large/);
        const odd = sampleScene() as any;
        odd.objects[0].kind = 'sphere';
        expect(validateScene(odd).ok).toBe(false);
    });
});
