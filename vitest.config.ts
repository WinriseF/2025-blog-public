import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src')
		}
	},
	test: {
		include: ['tests/**/*.test.{ts,tsx,js,mjs}'],
		environment: 'node',
		testTimeout: 20_000,
		hookTimeout: 20_000,
		restoreMocks: true,
		clearMocks: true,
		unstubGlobals: true,
		sequence: { concurrent: false },
		coverage: {
			provider: 'v8',
			reportsDirectory: './coverage',
			reporter: ['text', 'html', 'lcov'],
			include: ['src/**/*.{ts,tsx}'],
			exclude: ['src/**/*.worker.ts', 'src/**/*.test.*', '**/types.ts', 'src/lib/codex-session/browser-node-stub.ts']
		}
	}
})
