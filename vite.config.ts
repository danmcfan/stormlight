import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true },
  // swarm/ is a separate app with its own dependencies and test run.
  test: { exclude: ['**/node_modules/**', 'swarm/**'] },
});
