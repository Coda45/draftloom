import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { ImportMode, ReconstructionResult } from '../shared/reconstruction-contract';
import { createImportSession, getImportSession, reconstructImage, takePhoneImage, type ImportSession } from './client';
import { preprocessImage } from './preprocess/normalize';
import './import.css';

export interface ImportPanelProps {
    onSceneReady(result: ReconstructionResult, sourceImage: Blob): void | Promise<void>;
}

export function ImportPanel({ onSceneReady }: ImportPanelProps) {
    const [file, setFile] = useState<Blob>(); const [preview, setPreview] = useState<string>(); const [turns, setTurns] = useState(0); const [mode, setMode] = useState<ImportMode>('auto');
    const [session, setSession] = useState<ImportSession>(); const [qr, setQr] = useState<string>(); const [result, setResult] = useState<ReconstructionResult>(); const [processed, setProcessed] = useState<Blob>();
    const [status, setStatus] = useState('Choose a drawing or transfer one from your phone.'); const [busy, setBusy] = useState(false); const polling = useRef<AbortController | undefined>(undefined);
    useEffect(() => () => { polling.current?.abort(); if (preview) URL.revokeObjectURL(preview); }, [preview]);
    useEffect(() => {
        if (!session) return; const controller = new AbortController(); polling.current = controller;
        const timer = setInterval(async () => { try { const state = await getImportSession(session, controller.signal); if (state.status === 'uploaded') { clearInterval(timer); const image = await takePhoneImage(session, controller.signal); setFile(image); setPreview(URL.createObjectURL(image)); setStatus('Phone photo received.'); } else if (state.status === 'expired') { clearInterval(timer); setStatus('The QR upload link expired. Create another.'); } } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus(error instanceof Error ? error.message : 'Phone transfer failed.'); } }, 1500);
        return () => { clearInterval(timer); controller.abort(); };
    }, [session]);
    async function beginPhone(): Promise<void> { setBusy(true); try { const value = await createImportSession(); setSession(value); setQr(await QRCode.toDataURL(value.uploadUrl, { width: 240, margin: 1 })); setStatus('Scan this code with your phone.'); } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not create a phone session.'); } finally { setBusy(false); } }
    function choose(next?: File): void { if (!next) return; if (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type)) { setStatus('Choose a JPEG, PNG, or WebP image.'); return; } setFile(next); setPreview(URL.createObjectURL(next)); setResult(undefined); setStatus('Image ready to analyze.'); }
    async function analyze(): Promise<void> { if (!file) return; setBusy(true); setResult(undefined); try { setStatus('Measuring lines and colored shapes…'); const normalized = await preprocessImage(file, turns); setProcessed(normalized.blob); setPreview(normalized.previewUrl); setStatus('Interpreting the legend and reconstructing…'); setResult(await reconstructImage(normalized.blob, mode, normalized.observations)); setStatus('Review warnings, then import the editable scene.'); } catch (error) { setStatus(error instanceof Error ? error.message : 'Reconstruction failed.'); } finally { setBusy(false); } }
    async function accept(): Promise<void> { if (!result || !processed) return; setBusy(true); try { await onSceneReady(result, processed); setStatus('Scene imported.'); } catch (error) { setStatus(error instanceof Error ? error.message : 'The editor could not accept this scene.'); } finally { setBusy(false); } }
    return <section className="draftloom-import" aria-label="Import drawing">
        <h2>Import drawing</h2><p className="import-status" aria-live="polite">{status}</p>
        <div className="import-actions"><label className="import-button">Choose image<input hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => choose(event.target.files?.[0])} /></label><button type="button" onClick={beginPhone} disabled={busy}>Use phone</button></div>
        {qr && <div className="import-qr"><img src={qr} alt="QR code for temporary phone upload" /><a href={session?.uploadUrl} target="_blank" rel="noreferrer">Open upload page</a><small>Anyone with this short-lived link can upload one image.</small></div>}
        {preview && <><img className="import-preview" src={preview} alt="Drawing preview" /><div className="import-actions"><button type="button" onClick={() => setTurns((value) => value - 1)}>Rotate left</button><button type="button" onClick={() => setTurns((value) => value + 1)}>Rotate right</button><select value={mode} onChange={(event) => setMode(event.target.value as ImportMode)}><option value="auto">Auto detect</option><option value="floorplan">Floor plan</option><option value="isometric">Isometric (optional)</option></select><button type="button" onClick={analyze} disabled={busy}>Reconstruct</button></div></>}
        {result && <div className="import-review"><strong>{result.scene.objects.length} editable objects found</strong>{result.requiresScaleConfirmation && <p>Scale must be confirmed in the editor.</p>}<ul>{result.issues.map((issue) => <li key={issue.id ?? `${issue.code}-${issue.message}`}>{issue.message}</li>)}</ul><button type="button" onClick={accept} disabled={busy}>Import scene</button></div>}
        <small>When AI is configured, the image is sent to that provider for semantic interpretation. Manual editing remains available if import fails.</small>
    </section>;
}
