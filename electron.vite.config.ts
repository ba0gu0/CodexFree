import { resolve } from 'node:path'
import { paraglideVitePlugin } from '@inlang/paraglide-js'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [
      paraglideVitePlugin({
        project: './project.inlang',
        outdir: './src/renderer/src/paraglide',
        strategy: ['globalVariable', 'baseLocale']
      }),
      react(),
      tailwindcss()
    ]
  }
})
