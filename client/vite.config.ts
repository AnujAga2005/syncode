import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(), // Tailwind v4 Plugin
    nodePolyfills({
      // This ensures "global" and "process" work for simple-peer
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
  ],
  server: {
    allowedHosts: true, // Allows ngrok or any other tunnel
    host: true,         // Exposes the server to the network
  }
})