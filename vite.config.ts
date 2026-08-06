import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      rollupOptions: {
        output: {
          // Routes are already React.lazy-split, but shared vendor code was
          // all landing in the single entry chunk (701kB, over Vite's 500kB
          // warning threshold) — every page paid for chart.js/motion/socket.io
          // on first load regardless of whether it used them. Split by vendor
          // so the entry chunk only carries what every page actually needs.
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'chart-vendor': ['chart.js', 'react-chartjs-2'],
            'motion-vendor': ['motion'],
            'socket-vendor': ['socket.io-client'],
            'icon-vendor': ['lucide-react'],
          },
        },
      },
    },
  };
});
