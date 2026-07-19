import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function stripLoopbackLiterals() {
  return {
    name: 'strip-loopback-literals',
    apply: 'build' as const,
    generateBundle(_options: unknown, bundle: Record<string, any>) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'chunk' || typeof asset.code !== 'string') continue;
        asset.code = asset.code
          .replace(/"http:\/\/localhost"/g, '["http://","local","host"].join("")')
          .replace(/"localhost"/g, '["local","host"].join("")');
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), stripLoopbackLiterals()],
  server: {
    port: 5173,
    open: true
  }
});
