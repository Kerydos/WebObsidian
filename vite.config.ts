import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // CodeMirror·Lezer(에디터 엔진)와 아이콘 라이브러리를 별도 청크로 분리해
        // 단일 청크가 500kB 권장 한도를 넘지 않게 하고 캐시 효율을 높인다.
        advancedChunks: {
          groups: [
            { name: 'lezer', test: /[\\/]node_modules[\\/]@lezer[\\/]/ },
            { name: 'codemirror', test: /[\\/]node_modules[\\/](@codemirror|@uiw)[\\/]/ },
            { name: 'lucide', test: /[\\/]node_modules[\\/]lucide-react[\\/]/ },
          ],
        },
      },
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
