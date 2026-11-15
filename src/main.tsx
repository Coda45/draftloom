import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { MobileUploadPage, mobileUploadToken } from './import/public';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// Phones opening a QR link (/upload/:token) get only the upload page, never the editor.
// A malformed /upload/ path still gets that page, which reports the link as invalid.
const isUploadPath = window.location.pathname.startsWith('/upload/');

createRoot(root).render(<StrictMode>{isUploadPath ? <MobileUploadPage token={mobileUploadToken(window.location.pathname)} /> : <App />}</StrictMode>);
