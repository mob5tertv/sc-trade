import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'
import { previewPlugin } from './scripts/preview/vite-plugin.ts'

// https://vite.dev/config/
export default defineConfig({
  // `previewPlugin` serves the browser preview and exists for the dev server only; a build never has it.
  plugins: [svelte(), previewPlugin()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
})
