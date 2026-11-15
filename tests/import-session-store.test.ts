import { describe, expect, it } from 'vitest';
import { ImportSessionStore } from '../server/upload/session-store';

const image = { bytes: Buffer.from('image'), mimeType: 'image/png' as const, name: 'plan.png' };

describe('temporary import sessions', () => {
    it('uses separate one-use phone and editor credentials', () => {
        const store = new ImportSessionStore(1000, 2, () => 100);
        const session = store.create(); store.upload(session.uploadToken, image);
        expect(store.status(session.sessionId, session.editorToken).status).toBe('uploaded');
        expect(() => store.upload(session.uploadToken, image)).toThrow(/invalid, expired, or already used/i);
        expect(store.takeImage(session.sessionId, session.editorToken)).toEqual(image);
        expect(() => store.status(session.sessionId, session.editorToken)).toThrow(/missing or invalid/i);
    });

    it('expires sessions and enforces bounded capacity', () => {
        let now = 0; const store = new ImportSessionStore(10, 1, () => now); const session = store.create();
        expect(() => store.create()).toThrow(/too many/i); now = 11;
        expect(store.status(session.sessionId, session.editorToken).status).toBe('expired');
        expect(() => store.upload(session.uploadToken, image)).toThrow(/expired/i);
    });
});
