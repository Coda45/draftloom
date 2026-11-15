import { ApiError } from './errors';

export type SupportedImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ValidatedImage {
    bytes: Buffer;
    mimeType: SupportedImageType;
    widthPx?: number;
    heightPx?: number;
    name: string;
}

function pngDimensions(bytes: Buffer): [number, number] | undefined {
    if (bytes.length < 45 || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', bytes.length - 8, bytes.length - 4) !== 'IEND') return undefined;
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function jpegDimensions(bytes: Buffer): [number, number] | undefined {
    let offset = 2;
    while (offset + 8 < bytes.length) {
        if (bytes[offset] !== 0xff) {
            offset++;
            continue;
        }
        const marker = bytes[offset + 1];
        if (marker === 0xd8 || marker === 0xd9) {
            offset += 2;
            continue;
        }
        const length = bytes.readUInt16BE(offset + 2);
        if (length < 2 || offset + 2 + length > bytes.length) return undefined;
        if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
            return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
        }
        offset += 2 + length;
    }
    return undefined;
}

function webpDimensions(bytes: Buffer): [number, number] | undefined {
    if (bytes.length < 30) return undefined;
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
        const width = 1 + bytes.readUIntLE(24, 3);
        const height = 1 + bytes.readUIntLE(27, 3);
        return [width, height];
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
        const bits = bytes.readUInt32LE(21);
        return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
    }
    if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
        return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
    }
    return undefined;
}

export function inspectImage(bytes: Buffer): { mimeType: SupportedImageType; widthPx?: number; heightPx?: number } {
    let mimeType: SupportedImageType;
    let dimensions: [number, number] | undefined;
    if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
        mimeType = 'image/png';
        dimensions = pngDimensions(bytes);
    } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) {
        mimeType = 'image/jpeg';
        dimensions = jpegDimensions(bytes);
    } else if (bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
        mimeType = 'image/webp';
        dimensions = webpDimensions(bytes);
    } else {
        throw new ApiError(415, 'IMAGE_UNSUPPORTED', 'Upload a valid JPEG, PNG, or WebP image. SVG and other file types are not accepted.');
    }
    if (!dimensions) throw new ApiError(415, 'IMAGE_INVALID', 'The image file is incomplete or malformed.');
    if (dimensions[0] <= 0 || dimensions[1] <= 0 || dimensions[0] > 20000 || dimensions[1] > 20000) {
        throw new ApiError(422, 'IMAGE_DIMENSIONS_INVALID', 'The image dimensions are invalid or too large.');
    }
    return { mimeType, widthPx: dimensions?.[0], heightPx: dimensions?.[1] };
}

export function validateUpload(file: Express.Multer.File | undefined): ValidatedImage {
    if (!file) throw new ApiError(400, 'IMAGE_REQUIRED', 'Attach one image in the multipart field named "file".');
    const inspected = inspectImage(file.buffer);
    return {
        bytes: file.buffer,
        mimeType: inspected.mimeType,
        widthPx: inspected.widthPx,
        heightPx: inspected.heightPx,
        name: file.originalname || 'sketch',
    };
}
