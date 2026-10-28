import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // The mail core runs in its own utility process (src/main/mailclient)
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          mailWorker: resolve(__dirname, 'src/main/mailclient/worker.ts')
        }
      }
    }
  },
  // A sandboxed preload can require only Electron, so its dependencies are bundled
  preload: {
    build: { externalizeDeps: false }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
