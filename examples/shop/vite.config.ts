import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // The browser calls /api on the Vite origin, so Lightpath tags those requests without CORS (ADR 0004).
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
});
