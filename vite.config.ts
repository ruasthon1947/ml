import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import localDbPlugin from './server/localDbPlugin.mjs';
import chatPlugin from './server/chatPlugin.mjs';
import smsPlugin from './server/smsPlugin.mjs';

export default defineConfig({
  plugins: [react(), localDbPlugin(), chatPlugin(), smsPlugin()],
  server: {
    host: true,
    port: 5173,
    watch: {
      ignored: ['**/local_db/**'],
    },
  },
});
