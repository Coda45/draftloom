import { analyzePixels } from './analyzePixels';
import type { PreprocessedImage } from './types';

export async function preprocessImage(file: Blob, quarterTurns = 0, maxSide = 1800): Promise<PreprocessedImage> {
    const bitmap = await createImageBitmap(file);
    const turns = ((quarterTurns % 4) + 4) % 4;
    const rotated = turns % 2 === 1;
    const sourceWidth = rotated ? bitmap.height : bitmap.width;
    const sourceHeight = rotated ? bitmap.width : bitmap.height;
    const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas image processing is unavailable.');
    context.fillStyle = '#FFFFFF'; context.fillRect(0, 0, width, height);
    context.save(); context.translate(width / 2, height / 2); context.rotate(turns * Math.PI / 2);
    const drawWidth = bitmap.width * scale; const drawHeight = bitmap.height * scale;
    context.drawImage(bitmap, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight); context.restore(); bitmap.close();
    const observations = analyzePixels(context.getImageData(0, 0, width, height).data, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Image encoding failed.')), 'image/jpeg', 0.9));
    return { blob, observations, previewUrl: URL.createObjectURL(blob) };
}
