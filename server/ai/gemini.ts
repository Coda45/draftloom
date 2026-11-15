import { ApiError } from '../api/errors';
import type { SketchVisionProvider } from './types';

const RESPONSE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['mode', 'legendEntries', 'notes'],
    properties: {
        mode: { type: 'string', enum: ['floorplan', 'isometric'] },
        legendEntries: {
            type: 'array',
            maxItems: 32,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['label', 'colorHex'],
                properties: {
                    label: { type: 'string', description: 'Exact handwritten category label.' },
                    colorHex: { type: 'string', description: 'Six-digit RGB swatch color such as #3366CC.' },
                    defaultHeightM: { type: 'number', minimum: 0.01, maximum: 100 },
                },
            },
        },
        legendArea: {
            type: 'object',
            additionalProperties: false,
            required: ['x', 'y', 'width', 'height'],
            properties: {
                x: { type: 'number', minimum: 0, maximum: 1 },
                y: { type: 'number', minimum: 0, maximum: 1 },
                width: { type: 'number', minimum: 0, maximum: 1 },
                height: { type: 'number', minimum: 0, maximum: 1 },
            },
        },
        metersPerPixel: { type: 'number', minimum: 0.000001, maximum: 10 },
        wallHeightM: { type: 'number', minimum: 0.01, maximum: 100 },
        notes: { type: 'array', maxItems: 20, items: { type: 'string' } },
    },
} as const;

class Semaphore {
    private active = 0;
    private readonly waiting: Array<() => void> = [];

    constructor(private readonly limit: number) {}

    async use<T>(fn: () => Promise<T>): Promise<T> {
        if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
        this.active++;
        try {
            return await fn();
        } finally {
            this.active--;
            this.waiting.shift()?.();
        }
    }
}

export class GeminiSketchVisionProvider implements SketchVisionProvider {
    private readonly semaphore: Semaphore;

    constructor(
        private readonly apiKey: string,
        private readonly model: string,
        maxConcurrency: number,
        private readonly timeoutMs = 30000,
    ) {
        this.semaphore = new Semaphore(maxConcurrency);
    }

    analyzeSketch(input: Parameters<SketchVisionProvider['analyzeSketch']>[0]): Promise<unknown> {
        return this.semaphore.use(async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
            try {
                const prompt = [
                    'Interpret only the semantic legend and written scale cues in this annotated spatial sketch.',
                    'Do not invent wall or object coordinates; deterministic browser observations provide geometry.',
                    'Read each colored legend swatch and its handwritten category. Return the swatch RGB color.',
                    'If a real measurement or grid scale is explicitly written, return metersPerPixel; otherwise omit it.',
                    'Return normalized legendArea bounds when a legend/key region is visible.',
                    `Requested mode: ${input.mode}.`,
                    input.promptContext ?? '',
                ].join('\n');
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
                    signal: controller.signal,
                    body: JSON.stringify({
                        contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: input.mimeType, data: Buffer.from(input.imageBytes).toString('base64') } }] }],
                        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: RESPONSE_SCHEMA, temperature: 0.1 },
                    }),
                });
                if (!response.ok) {
                    const retryable = response.status === 429 || response.status >= 500;
                    throw new ApiError(502, 'AI_PROVIDER_ERROR', `The configured AI provider returned HTTP ${response.status}.`, retryable);
                }
                const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
                const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
                if (!text) throw new ApiError(502, 'AI_RESPONSE_EMPTY', 'The AI provider returned no structured result.', true);
                try {
                    return JSON.parse(text);
                } catch {
                    throw new ApiError(502, 'AI_RESPONSE_INVALID', 'The AI provider returned malformed JSON.', true);
                }
            } catch (error) {
                if (error instanceof ApiError) throw error;
                if (error instanceof Error && error.name === 'AbortError') throw new ApiError(504, 'AI_TIMEOUT', 'The AI analysis timed out.', true);
                throw new ApiError(502, 'AI_PROVIDER_ERROR', 'The AI provider request failed.', true);
            } finally {
                clearTimeout(timeout);
            }
        });
    }
}
