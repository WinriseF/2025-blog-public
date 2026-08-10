export function createRequire(): never {
	throw new Error('Node module API is unavailable in the browser')
}

export async function readFile(): Promise<never> {
	throw new Error('Node filesystem API is unavailable in the browser')
}
