import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';

const manifest = JSON.parse(readFileSync('./manifest.json', 'utf-8'));

export default defineConfig({
  plugins: [crx({ manifest })],
});
