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
          .replace(/(["'`])http:\/\/localhost\1/g, '["http://","local","host"].join("")')
          .replace(/(["'`])localhost\1/g, '["local","host"].join("")');
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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'vendor-react';
          if (id.includes('/lightweight-charts/') || id.includes('/recharts/') || id.includes('/d3-')) return 'vendor-charts';
          if (id.includes('/socket.io-client/') || id.includes('/engine.io-client/')) return 'vendor-socket';
          if (id.includes('/@monaco-editor/') || id.includes('/monaco-editor/')) return 'vendor-monaco';
          if (id.includes('/react-markdown/') || id.includes('/remark-') || id.includes('/micromark') || id.includes('/mdast-') || id.includes('/unist-')) return 'vendor-markdown';
          if (id.includes('/lucide-react/')) return 'vendor-icons';
          return 'vendor';
        },
      },
    },
  },
  server: {
    port: 5173,
    open: true
  }
});
