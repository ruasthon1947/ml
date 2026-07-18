import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import chatPlugin from './server/chatPlugin.mjs';

export default defineConfig({
  plugins: [
    react(),
    chatPlugin() // Intercepts /api/chat and /api/login directly in memory
  ],
  server: {
    port: 5173,
    proxy: {
      // Bypasses the network proxy for your local endpoints by returning bypass true
      '/api': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        bypass: (req) => {
          const url = req.url || '';
          if (url.startsWith('/api/chat') || url.startsWith('/api/login')) {
            return url; // Tell Vite's proxy connection pool to back off and drop into the plugin pipeline
          }
        }
      }
    }
  }
});