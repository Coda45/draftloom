// Minimal browser FileReader for Node tests; GLTFExporter uses it to pack GLB buffers.
class NodeFileReader {
    result: ArrayBuffer | string | null = null;
    onloadend: (() => void) | null = null;
    onerror: ((err: unknown) => void) | null = null;

    readAsArrayBuffer(blob: Blob): void {
        blob.arrayBuffer().then((buf) => {
            this.result = buf;
            this.onloadend?.();
        }, (err) => this.onerror?.(err));
    }

    readAsDataURL(blob: Blob): void {
        blob.arrayBuffer().then((buf) => {
            this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`;
            this.onloadend?.();
        }, (err) => this.onerror?.(err));
    }
}

if (typeof globalThis.FileReader === 'undefined') {
    (globalThis as unknown as { FileReader: unknown }).FileReader = NodeFileReader;
}
