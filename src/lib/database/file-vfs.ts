import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import { createReadCache } from './read-cache'

// The package's struct types omit the generated $method pointer properties.
type StructPointers = { pointer: number; [key: `$${string}`]: number }

export function createFileVfs(sqlite: Sqlite3Static, file: File, scratchVfs: string) {
	const { capi, wasm } = sqlite
	const reader = new FileReaderSync()
	const stats = { bytesRead: 0, readCalls: 0, maxOffset: 0, tempFiles: 0 }
	const cache = createReadCache(file.size, (start, end) => {
		const buffer = reader.readAsArrayBuffer(file.slice(start, end))
		stats.readCalls++
		stats.bytesRead += buffer.byteLength
		return buffer
	})
	const base = new capi.sqlite3_vfs(capi.sqlite3_vfs_find(scratchVfs))
	const vfs = new capi.sqlite3_vfs()
	const io = new capi.sqlite3_io_methods()
	const basePointers = base as unknown as StructPointers
	const delegate = (name: string, ...args: number[]) => wasm.functionEntry(basePointers[`$${name}`])!(base.pointer, ...args) as number
	vfs.$iVersion = 2
	vfs.$szOsFile = base.$szOsFile
	vfs.$mxPathname = base.$mxPathname
	;(io as unknown as StructPointers).$iVersion = 1
	const isSource = (name: number) => wasm.cstrToJs(name) === '/selected.sqlite'

	// These callbacks cross into C: convert I/O exceptions to SQLite result codes.
	const methods = {
		xClose: () => capi.SQLITE_OK,
		xRead: (_file: number, output: number, amount: number, offset: bigint) => {
			try {
				const start = Number(offset)
				if (!Number.isSafeInteger(start) || start < 0) return capi.SQLITE_IOERR_READ
				const target = wasm.heap8u().subarray(output, output + amount)
				const copied = cache.readInto(start, target)
				stats.maxOffset = Math.max(stats.maxOffset, start)
				if (copied < amount) {
					return capi.SQLITE_IOERR_SHORT_READ
				}
				return capi.SQLITE_OK
			} catch {
				return capi.SQLITE_IOERR_READ
			}
		},
		xWrite: () => capi.SQLITE_READONLY,
		xTruncate: () => capi.SQLITE_READONLY,
		xSync: () => capi.SQLITE_OK,
		xFileSize: (_file: number, output: number) => {
			wasm.poke(output, file.size, 'i64')
			return capi.SQLITE_OK
		},
		xLock: () => capi.SQLITE_OK,
		xUnlock: () => capi.SQLITE_OK,
		xCheckReservedLock: (_file: number, output: number) => {
			wasm.poke(output, 0, 'i32')
			return capi.SQLITE_OK
		},
		xFileControl: () => capi.SQLITE_NOTFOUND,
		xSectorSize: () => 4096,
		xDeviceCharacteristics: () => 0x2000 // SQLITE_IOCAP_IMMUTABLE: only closed, complete files are supported.
	}
	io.installMethods(methods)
	vfs.installMethods({
		xOpen: (_vfs: number, name: number, output: number, flags: number, outFlags: number) => {
			if (isSource(name)) {
				if (flags & (capi.SQLITE_OPEN_READWRITE | capi.SQLITE_OPEN_CREATE)) return capi.SQLITE_READONLY
				const handle = new capi.sqlite3_file(output)
				handle.$pMethods = io.pointer
				handle.dispose()
				if (outFlags) wasm.poke(outFlags, capi.SQLITE_OPEN_READONLY, 'i32')
				return capi.SQLITE_OK
			}
			// Only SQLite's internal temporary files may be opened on the writable VFS.
			if (flags & (capi.SQLITE_OPEN_MAIN_DB | capi.SQLITE_OPEN_MAIN_JOURNAL | capi.SQLITE_OPEN_WAL)) return capi.SQLITE_CANTOPEN
			const result = delegate('xOpen', name, output, flags, outFlags)
			if (result === capi.SQLITE_OK) stats.tempFiles++
			return result
		},
		xAccess: (_vfs: number, name: number, flags: number, output: number) => {
			if (isSource(name)) {
				wasm.poke(output, flags === capi.SQLITE_ACCESS_READWRITE ? 0 : 1, 'i32')
				return 0
			}
			return delegate('xAccess', name, flags, output)
		},
		xDelete: (_vfs: number, name: number, sync: number) => (isSource(name) ? capi.SQLITE_READONLY : delegate('xDelete', name, sync)),
		xFullPathname: (_vfs: number, name: number, length: number, output: number) => delegate('xFullPathname', name, length, output),
		xRandomness: (_vfs: number, length: number, output: number) => delegate('xRandomness', length, output),
		xSleep: () => 0,
		xCurrentTime: (_vfs: number, output: number) => delegate('xCurrentTime', output),
		xCurrentTimeInt64: (_vfs: number, output: number) => delegate('xCurrentTimeInt64', output)
	})
	sqlite.vfs.installVfs({ vfs: { struct: vfs, methods: {}, name: 'local-file' } })
	return {
		name: 'local-file',
		stats,
		dispose() {
			cache.clear()
			capi.sqlite3_vfs_unregister(vfs)
			vfs.dispose()
			io.dispose()
			base.dispose()
		}
	}
}
