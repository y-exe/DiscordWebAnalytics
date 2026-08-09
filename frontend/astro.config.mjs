import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  site: 'https://www.ymkw.top',
  output: 'static',
  integrations: [react()],
  vite: {
    server: {
      allowedHosts: ['ymkw.top'],
      proxy: Object.fromEntries(
        ['/channels', '/users', '/ranking', '/stats'].map((path) => [
          path,
          {
            target: 'https://api.ymkw.top',
            changeOrigin: true,
            secure: true,
          },
        ])
      ),
    },
  },
});
