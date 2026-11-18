import { loadZipModule, type Zip } from '../zip-runtime'
export type { Entry } from '../zip-runtime'

export function loadOfficeZip() {
	return loadZipModule<Zip>()
}

export { readZipBlob as readPart } from '../zip-runtime'
