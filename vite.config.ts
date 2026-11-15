import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The reconstruction API (Developer B's Express server) runs separately;
// Vite proxies /api to it during local development.
const apiTarget = process.env.DRAFTLOOM_API_URL ?? 'http://localhost:3001';

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: apiTarget,
                changeOrigin: true,
            },
        },
    },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
    },
});
