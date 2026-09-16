import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 产物为单一 HTML：所有 JS / CSS / three.js 运行时全部内联，离线双击可用。
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 5_000,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});
