import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'WebObsidian',
        short_name: 'WebObsidian',
        description: 'A local-first Markdown knowledge workspace',
        theme_color: '#171512',
        background_color: '#f4f0e8',
        display: 'standalone',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      },
    }),
  ],
});
