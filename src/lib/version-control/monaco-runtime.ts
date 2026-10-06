'use client'

import loader from '@monaco-editor/loader'
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'

// Keep the CDN runtime and the dev-only monaco-editor types on the same version.
const CDN_ROOT = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/'
let runtime: Promise<typeof Monaco> | undefined

export function loadWorkspaceMonaco() {
	if (!runtime) {
		const workerSource = `self.MonacoEnvironment = { baseUrl: ${JSON.stringify(CDN_ROOT)} }; importScripts(${JSON.stringify(`${CDN_ROOT}vs/base/worker/workerMain.js`)});`
		// Shared for the page lifetime: language workers may start after an editor unmounts.
		const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
		;(window as Window & { MonacoEnvironment?: Monaco.Environment }).MonacoEnvironment = { getWorkerUrl: () => workerUrl }
		loader.config({ paths: { vs: `${CDN_ROOT}vs` }, 'vs/nls': { availableLanguages: { '*': 'zh-cn' } } })
		runtime = Promise.resolve(loader.init())
	}
	return runtime
}
