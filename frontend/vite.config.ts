import { assertDeploymentFlags, assertStagingOrigin, stagingBrowserContainment } from './build/staging'
import { defineConfig } from "vitest/config"
import { loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  assertDeploymentFlags(env, command === 'build' ? 'production' : mode)
  if (env.VITE_DEPLOYMENT_ENV === 'staging' && (mode !== 'test' || command === 'build')) {
    assertStagingOrigin(env.VITE_STAGING_PAYROLL_FRONTEND_ORIGIN, 'VITE_STAGING_PAYROLL_FRONTEND_ORIGIN')
    for (const key of ['VITE_STAGING_SNAPSHOT_AT', 'VITE_STAGING_CODE_SHA', 'VITE_API_URL', 'VITE_CLERK_PUBLISHABLE_KEY']) {
      if (!env[key]) throw new Error(`Staging build requires ${key}`)
    }
    const api = new URL(env.VITE_API_URL)
    if (api.protocol !== 'https:' || api.port || api.username || api.password || !/(?:^|[.-])staging(?:[.-]|$)/.test(api.hostname)) {
      throw new Error('Staging build requires an explicit HTTPS staging API hostname')
    }
    if (!/^[0-9a-f]{40}$/.test(env.VITE_STAGING_CODE_SHA)) throw new Error('VITE_STAGING_CODE_SHA must be a full commit SHA')
    if (Number.isNaN(Date.parse(env.VITE_STAGING_SNAPSHOT_AT))) throw new Error('VITE_STAGING_SNAPSHOT_AT must be a recorded timestamp')
    if (!env.VITE_CLERK_PUBLISHABLE_KEY.startsWith('pk_test_')) throw new Error('Staging build requires a separate test Clerk instance')
    if (env.VITE_AUTH_ENABLED === 'false') throw new Error('Staging build requires authentication')
  }
  return {
  plugins: [stagingBrowserContainment(env.VITE_DEPLOYMENT_ENV === 'staging'), react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-clerk": ["@clerk/clerk-react"],
          "vendor-analytics": ["posthog-js"],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    pool: "threads",
    setupFiles: "./src/test/setup.ts",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: true,
  },
}
})
