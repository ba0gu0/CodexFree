import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

interface PackageJson {
  dependencies?: Record<string, string>
}

function readPackageJson(): PackageJson {
  const value = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  const dependencies = (value as { dependencies?: unknown }).dependencies
  if (typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies)) {
    return {}
  }
  return { dependencies: dependencies as Record<string, string> }
}

const externalDependencies = ['electron', ...Object.keys(readPackageJson().dependencies ?? {})]

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: externalDependencies
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        external: externalDependencies
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    server: {
      host: '127.0.0.1'
    },
    plugins: [react(), tailwindcss()]
  }
})
