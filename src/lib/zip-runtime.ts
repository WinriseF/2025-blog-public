const ZIP_RUNTIME_URL = 'https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.8.59/index-native.min.js'
let pending: Promise<unknown> | undefined

export function loadZipModule<T>(): Promise<T> {
	if (!pending) {
		pending = import(/* webpackIgnore: true */ ZIP_RUNTIME_URL)
		pending.catch(() => { pending = undefined })
	}
	return pending as Promise<T>
}
