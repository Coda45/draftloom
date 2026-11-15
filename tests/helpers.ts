import sample from '../samples/simple-studio.draftloom.json';
import type { SceneDocument } from '../src/scene/schema';

/** Deep copy of the sample fixture so tests can't affect each other. */
export function sampleScene(): SceneDocument {
    return structuredClone(sample) as SceneDocument;
}
