import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = dirname(fileURLToPath(import.meta.url))
const frontendFixture = resolve(scriptsDirectory, '..', 'protocol-fixtures', 'native-file-v1.json')
const rustFixture = resolve(scriptsDirectory, '..', '..', '2025-blog-tools', 'protocol-fixtures', 'native-file-v1.json')
const [frontend, rust] = await Promise.all([readFile(frontendFixture, 'utf8'), readFile(rustFixture, 'utf8')])

if (JSON.stringify(JSON.parse(frontend)) !== JSON.stringify(JSON.parse(rust))) {
	throw new Error('Rust and TypeScript Native File V1 fixtures differ')
}
