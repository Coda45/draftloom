import { useEffect, useState } from 'react';
import { uploadPhoneImage } from './client';
import './import.css';

export function mobileUploadToken(pathname = window.location.pathname): string | undefined {
    const match = pathname.match(/^\/upload\/([^/]+)\/?$/); if (!match) return undefined;
    try { return decodeURIComponent(match[1]); } catch { return undefined; }
}

export function MobileUploadPage({ token = mobileUploadToken() }: { token?: string }) {
    const [file, setFile] = useState<File>(); const [preview, setPreview] = useState<string>(); const [status, setStatus] = useState(token ? 'Photograph or choose your drawing.' : 'This upload link is invalid.'); const [busy, setBusy] = useState(false);
    useEffect(() => { if (!file) { setPreview(undefined); return; } const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url); }, [file]);
    async function send(): Promise<void> { if (!token || !file) return; setBusy(true); try { await uploadPhoneImage(token, file); setStatus('Uploaded. Return to Draftloom on your computer.'); setFile(undefined); } catch (error) { setStatus(error instanceof Error ? error.message : 'Upload failed.'); } finally { setBusy(false); } }
    return <main className="draftloom-mobile"><h1>Send drawing to Draftloom</h1><p aria-live="polite">{status}</p><label className="import-button">Take photo or choose image<input hidden type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={!token || busy} onChange={(event) => setFile(event.target.files?.[0])} /></label>{file && <><p>{file.name}</p>{preview && <img className="import-preview" src={preview} alt="Photo ready to upload" />}<button type="button" onClick={send} disabled={busy}>{busy ? 'Uploading…' : 'Upload drawing'}</button></>}</main>;
}
