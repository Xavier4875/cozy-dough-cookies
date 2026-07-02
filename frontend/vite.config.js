import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Lets the React app call "/api/..." without worrying about the
      // backend's port or CORS during local development.
      '/api': 'http://localhost:4000',
    },
  },
});
