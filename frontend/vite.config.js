import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // amazon-cognito-identity-js (a Node-oriented package) references the
  // Node.js `global` object, which doesn't exist in the browser — Vite
  // doesn't polyfill Node globals the way webpack historically did.
  define: {
    global: 'globalThis',
  },
  server: {
    proxy: {
      // Lets the React app call "/api/..." without worrying about the
      // backend's port or CORS during local development.
      '/api': 'http://localhost:4000',
    },
  },
});
