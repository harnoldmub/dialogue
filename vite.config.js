import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        participer: resolve(import.meta.dirname, 'participer.html'),
        mentions: resolve(import.meta.dirname, 'mentions.html'),
        notFound: resolve(import.meta.dirname, '404.html')
      }
    }
  }
});
