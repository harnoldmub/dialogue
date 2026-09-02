import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://127.0.0.1:5190',
        changeOrigin: true
      },
      '/health': {
        target: process.env.VITE_API_TARGET || 'http://127.0.0.1:5190',
        changeOrigin: true
      }
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        participer: resolve(import.meta.dirname, 'participer.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
        mentions: resolve(import.meta.dirname, 'mentions.html'),
        notFound: resolve(import.meta.dirname, '404.html')
      }
    }
  }
});
