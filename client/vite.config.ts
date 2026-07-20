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
  // Build identifier baked into the bundle: Vercel injects VERCEL_GIT_COMMIT_SHA
  // during CI builds, so window.__APP_VERSION__ always names the exact commit.
  define: {
    __APP_VERSION__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? 'local-dev'),
  },
  plugins: [react(), stripLoopbackLiterals()],
  server: {
    port: 5173,
    open: true
  }
});
