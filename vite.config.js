import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // base "/" is correct for a custom domain (illustratedvault.com).
  // Do NOT change this to a subdirectory path — that would break GitHub Pages
  // with the custom domain. A subdirectory base is only needed for
  // username.github.io/repo-name deployments without a custom domain.
  base: '/',
});
