import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/');
          if (!normalized.includes('/node_modules/')) return undefined;
          if (normalized.includes('/firebase/') || normalized.includes('/@firebase/')) {
            return 'vendor-firebase';
          }
          if (
            normalized.includes('/recharts/') ||
            normalized.includes('/d3-') ||
            normalized.includes('/victory-vendor/')
          ) {
            return 'vendor-charts';
          }
          if (normalized.includes('/lucide-react/')) {
            return 'vendor-icons';
          }
          if (
            normalized.includes('/react/') ||
            normalized.includes('/react-dom/') ||
            normalized.includes('/react-router') ||
            normalized.includes('/scheduler/')
          ) {
            return 'vendor-react';
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
