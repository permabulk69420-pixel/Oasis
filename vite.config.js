import { defineConfig } from 'vite';

// The build id is stamped on every asset request (src/asset-version.js) so a new deploy is never served from the browser's cache of
// the old one. GitHub Actions provides the commit; a local build uses the time. The dev server has none.
export default defineConfig(({ command }) => ({
  base: './',
  server: { host: '0.0.0.0', port: 4173, allowedHosts: ['terminal.local'] },
  build: { target: 'es2022' },
  define: {
    __BUILD_ID__: JSON.stringify(command === 'build' ? (process.env.GITHUB_SHA || Date.now().toString(36)).slice(0, 12) : ''),
  },
}));
