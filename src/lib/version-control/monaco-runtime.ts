'use client'

import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'

// Keep the CDN runtime and the dev-only monaco-editor types on the same version.
const CDN_ROOT = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/'
type AmdRequire = {
	(dependencies: string[], resolve: (monaco: typeof Monaco) => void, reject: (error: unknown) => void): void
	config: (options: Record<string, unknown>) => void
}
let runtime: Promise<typeof Monaco> | undefined

export function loadWorkspaceMonaco() {
	if (!runtime) {
		const host = window as unknown as { MonacoEnvironment?: Monaco.Environment; monaco?: typeof Monaco; require?: AmdRequire }
		const workerSource = `self.MonacoEnvironment = { baseUrl: ${JSON.stringify(CDN_ROOT)} }; importScripts(${JSON.stringify(`${CDN_ROOT}vs/base/worker/workerMain.js`)});`
		// Shared for the page lifetime: language workers may start after an editor unmounts.
		const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
		host.MonacoEnvironment = { getWorkerUrl: () => workerUrl }
		// Use Monaco's AMD entry directly: @monaco-editor/loader 1.7.0 leaves an
		// unhandled rejected .then() branch when its script fails (an Event).
		runtime = new Promise<typeof Monaco>((resolve, reject) => {
			if (host.monaco?.editor) return resolve(host.monaco)
			const fail = (error: unknown) => reject(error instanceof Error ? error : new Error('Monaco 编辑器资源加载失败，请检查网络后刷新页面。'))
			const start = () => {
				try {
					if (!host.require) throw new Error('Monaco 加载器未就绪。')
					host.require.config({ paths: { vs: `${CDN_ROOT}vs` }, 'vs/nls': { availableLanguages: { '*': 'zh-cn' } } })
					host.require(['vs/editor/editor.main'], resolve, fail)
				} catch (error) {
					fail(error)
				}
			}
			if (host.require?.config) return start()
			const script = document.createElement('script')
			script.src = `${CDN_ROOT}vs/loader.js`
			script.onload = start
			script.onerror = fail
			document.body.appendChild(script)
		})
	}
	return runtime
}
