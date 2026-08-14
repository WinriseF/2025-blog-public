import type { RepositoryDataSource, DiffFilesPage, DirectoryPage, HistoryPage } from './repository-data-source'
import type {
	ConflictPerspective,
	DiffFile,
	DiffSessionInfo,
	GraphCommit,
	PreviewContent,
	RepositoryOverview,
	RepositoryFileContent,
	RepositoryTreeEntry,
	RevisionRef,
	WorkingTreeGroup
} from './types'

const API_ROOT = 'https://api.github.com'
const API_VERSION = '2026-03-10'
const NETWORK_PAGE_SIZE = 100
const UI_PAGE_SIZE = 30
const DIFF_PAGE_SIZE = 96
const DIRECTORY_PAGE_SIZE = 96
const SOURCE_LIMIT = 2 * 1024 * 1024

type GitHubRepository = {
	full_name: string
	default_branch: string
}

type GitHubCommit = {
	sha: string
	author: { login: string } | null
	commit: {
		message: string
		author: { name: string; date: string } | null
		committer: { name: string; date: string } | null
	}
	parents: Array<{ sha: string }>
}

type GitHubChangedFile = {
	filename: string
	previous_filename?: string
	status: string
	additions: number
	deletions: number
	patch?: string
}

type GitHubCommitDetail = GitHubCommit & {
	files?: GitHubChangedFile[]
}

type GitHubComparison = {
	files?: GitHubChangedFile[]
}

type GitHubContent = {
	name: string
	path: string
	type: 'file' | 'dir' | 'symlink' | 'submodule'
	size: number
}

type HistoryStream = {
	items: GraphCommit[]
	nextApiPage: number
	exhausted: boolean
}

type DiffEntry = {
	file: GitHubChangedFile
	view: DiffFile
}

type DiffSession = {
	oldRevision: RevisionRef
	newRevision: RevisionRef
	entries: DiffEntry[]
}

export class GitHubRestRepositoryDataSource implements RepositoryDataSource {
	readonly source = 'github-rest'
	readonly key: string
	private readonly baseUrl: string
	private overview: RepositoryOverview
	private abortController = new AbortController()
	private historyPages = new Map<number, Promise<GitHubCommit[]>>()
	private historyStreams = new Map<string, HistoryStream>()
	private commitBySha = new Map<string, GraphCommit>()
	private details = new Map<string, Promise<GitHubCommitDetail>>()
	private comparisons = new Map<string, Promise<GitHubComparison>>()
	private directories = new Map<string, Promise<RepositoryTreeEntry[]>>()
	private files = new Map<string, Promise<string>>()
	private diffs = new Map<string, DiffSession>()
	private diffSequence = 0

	private constructor(
		owner: string,
		repositoryName: string,
		repository: GitHubRepository
	) {
		this.key = `github-rest:${owner}/${repositoryName}`
		this.baseUrl = `${API_ROOT}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repositoryName)}`
		this.overview = createOverview(repository)
	}

	static async open(input: string) {
		const { owner, repository } = parseGitHubRepository(input)
		const baseUrl = `${API_ROOT}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`
		const response = await githubRequest(baseUrl)
		const metadata = (await response.json()) as GitHubRepository
		return new GitHubRestRepositoryDataSource(owner, repository, metadata)
	}

	connectHistory() {
		return Promise.resolve(this.overview)
	}

	close() {
		return Promise.resolve()
	}

	dispose() {
		this.abortController.abort()
		this.clearCaches()
	}

	async refresh() {
		this.abortController.abort()
		this.abortController = new AbortController()
		this.clearCaches()
		const response = await this.request(this.baseUrl)
		this.overview = createOverview((await response.json()) as GitHubRepository)
		return this.overview
	}

	async getHistory(query: string | null, cursor: string | null, limit = UI_PAGE_SIZE): Promise<HistoryPage> {
		const normalizedQuery = query?.trim().toLocaleLowerCase() || ''
		const offset = parseCursor(cursor)
		const pageSize = Math.max(1, Math.min(limit, UI_PAGE_SIZE))
		let stream = this.historyStreams.get(normalizedQuery)
		if (!stream) {
			stream = { items: [], nextApiPage: 1, exhausted: false }
			this.historyStreams.set(normalizedQuery, stream)
		}
		while (stream.items.length < offset + pageSize && !stream.exhausted) {
			const apiPage = stream.nextApiPage
			const page = await this.getHistoryNetworkPage(apiPage)
			stream.nextApiPage += 1
			stream.exhausted = page.length < NETWORK_PAGE_SIZE
			for (let index = 0; index < page.length; index += 1) {
				const commit = toGraphCommit(page[index], this.overview.currentBranch, apiPage === 1 && index === 0)
				this.commitBySha.set(commit.hash, commit)
				if (matchesCommit(commit, normalizedQuery)) stream.items.push(commit)
			}
		}
		const items = stream.items.slice(offset, offset + pageSize)
		const nextOffset = offset + items.length
		return { items, nextCursor: nextOffset < stream.items.length || !stream.exhausted ? String(nextOffset) : null }
	}

	async getDirectory(path: string, cursor: string | null, limit = DIRECTORY_PAGE_SIZE): Promise<DirectoryPage> {
		const normalizedPath = normalizeRepositoryPath(path)
		const offset = parseCursor(cursor)
		const pageSize = Math.max(1, Math.min(limit, DIRECTORY_PAGE_SIZE))
		const entries = await this.getDirectoryListing(normalizedPath)
		const items = entries.slice(offset, offset + pageSize)
		const nextOffset = offset + items.length
		return { items, nextCursor: nextOffset < entries.length ? String(nextOffset) : null }
	}

	async openRepositoryFile(path: string): Promise<RepositoryFileContent> {
		const normalizedPath = normalizeRepositoryPath(path)
		if (!normalizedPath) throw new Error('请选择文件')
		const content = await this.getFile(required(this.overview.currentBranch, '远端仓库没有可读取的分支'), normalizedPath)
		return { path: normalizedPath, content, size: new TextEncoder().encode(content).byteLength }
	}

	async openDiff(oldRevision: RevisionRef, newRevision: RevisionRef, _group: WorkingTreeGroup): Promise<DiffSessionInfo> {
		if (newRevision.kind !== 'commit' || (oldRevision.kind !== 'commit' && oldRevision.kind !== 'empty'))
			throw new Error('远端仓库只支持提交之间的比较')

		const knownCommit = this.commitBySha.get(newRevision.oid)
		const isCommitDetail = oldRevision.kind === 'empty' || knownCommit?.parentHashes[0] === oldRevision.oid
		const changedFiles = isCommitDetail
			? (await this.getCommitDetail(newRevision.oid)).files || []
			: (await this.getComparison(oldRevision.oid, newRevision.oid)).files || []
		const entries = changedFiles.map((file, fileId) => ({ file, view: toDiffFile(file, fileId) }))
		const diffId = `github:${++this.diffSequence}`
		const info = { diffId, summary: summarize(entries), totalFiles: entries.length }
		this.diffs.set(diffId, { oldRevision, newRevision, entries })
		return info
	}

	async getDiffFiles(diffId: string, cursor: string | null, limit = DIFF_PAGE_SIZE): Promise<DiffFilesPage> {
		const session = required(this.diffs.get(diffId), '远端差异会话已失效')
		const offset = parseCursor(cursor)
		const pageSize = Math.max(1, Math.min(limit, DIFF_PAGE_SIZE))
		const items = session.entries.slice(offset, offset + pageSize).map(entry => entry.view)
		const nextOffset = offset + items.length
		return { items, nextCursor: nextOffset < session.entries.length ? String(nextOffset) : null }
	}

	async openPreview(
		diffId: string,
		fileId: number,
		_perspective: ConflictPerspective,
		mode: 'full' | 'patch' = 'full'
	): Promise<PreviewContent> {
		const session = required(this.diffs.get(diffId), '远端差异会话已失效')
		const entry = required(session.entries[fileId], '远端文件不存在')
		if (mode === 'patch' && entry.file.patch)
			return { original: createPatch(entry.file), modified: '', mode: 'patch' }

		const oldRef = session.oldRevision.kind === 'commit' ? session.oldRevision.oid : null
		const newRef = session.newRevision.kind === 'commit' ? session.newRevision.oid : null
		const oldPath = entry.file.previous_filename || entry.file.filename
		const [original, modified] = await Promise.all([
			oldRef && entry.file.status !== 'added' ? this.getFile(oldRef, oldPath) : '',
			newRef && entry.file.status !== 'removed' ? this.getFile(newRef, entry.file.filename) : ''
		])
		return { original, modified, mode: 'full' }
	}

	private getHistoryNetworkPage(page: number) {
		let request = this.historyPages.get(page)
		if (!request) {
			const url = `${this.baseUrl}/commits?sha=${encodeURIComponent(this.overview.currentBranch || '')}&per_page=${NETWORK_PAGE_SIZE}&page=${page}`
			request = this.request(url)
				.then(response => response.json() as Promise<GitHubCommit[]>)
				.catch(error => {
					if (error instanceof GitHubApiError && error.status === 409) return []
					throw error
				})
			this.historyPages.set(page, request)
		}
		return request
	}

	private getCommitDetail(sha: string) {
		let request = this.details.get(sha)
		if (!request) {
			request = this.fetchCommitDetail(sha)
			this.details.set(sha, request)
		}
		return request
	}

	private async fetchCommitDetail(sha: string) {
		let url: string | null = `${this.baseUrl}/commits/${encodeURIComponent(sha)}?per_page=${NETWORK_PAGE_SIZE}&page=1`
		let detail: GitHubCommitDetail | null = null
		const files: GitHubChangedFile[] = []
		while (url) {
			const response = await this.request(url)
			const page = (await response.json()) as GitHubCommitDetail
			detail ||= page
			files.push(...(page.files || []))
			url = nextLink(response.headers.get('link'))
		}
		return { ...required(detail, 'GitHub 没有返回提交详情'), files }
	}

	private getComparison(base: string, head: string) {
		const key = `${base}...${head}`
		let request = this.comparisons.get(key)
		if (!request) {
			const url = `${this.baseUrl}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=${NETWORK_PAGE_SIZE}`
			request = this.request(url).then(response => response.json() as Promise<GitHubComparison>)
			this.comparisons.set(key, request)
		}
		return request
	}

	private getDirectoryListing(path: string) {
		const key = `${this.overview.currentBranch}:${path}`
		let request = this.directories.get(key)
		if (!request) {
			const encodedPath = path ? `/${path.split('/').map(encodeURIComponent).join('/')}` : ''
			const url = `${this.baseUrl}/contents${encodedPath}?ref=${encodeURIComponent(this.overview.currentBranch || '')}`
			request = this.request(url)
				.then(response => response.json() as Promise<GitHubContent[] | GitHubContent>)
				.then(contents => {
					if (!Array.isArray(contents)) throw new Error('所选路径不是文件夹')
					return contents.map(toRepositoryTreeEntry).sort(compareRepositoryEntries)
				})
			this.directories.set(key, request)
		}
		return request
	}

	private getFile(ref: string, path: string) {
		const key = `${ref}:${path}`
		let request = this.files.get(key)
		if (!request) {
			const encodedPath = path.split('/').map(encodeURIComponent).join('/')
			const url = `${this.baseUrl}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`
			request = this.request(url, 'application/vnd.github.raw+json').then(readBoundedText)
			this.files.set(key, request)
		}
		return request
	}

	private request(url: string, accept?: string) {
		return githubRequest(url, this.abortController.signal, accept)
	}

	private clearCaches() {
		this.historyPages.clear()
		this.historyStreams.clear()
		this.commitBySha.clear()
		this.details.clear()
		this.comparisons.clear()
		this.directories.clear()
		this.files.clear()
		this.diffs.clear()
	}
}

class GitHubApiError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message)
	}
}

async function githubRequest(url: string, signal?: AbortSignal, accept = 'application/vnd.github+json') {
	if (!url.startsWith(`${API_ROOT}/`)) throw new Error('GitHub API 地址无效')
	const headers: Record<string, string> = {
		Accept: accept,
		'X-GitHub-Api-Version': API_VERSION
	}
	const response = await fetch(url, { headers, signal })
	if (response.ok) return response
	let detail = ''
	try {
		detail = ((await response.json()) as { message?: string }).message || ''
	} catch {
		detail = response.statusText
	}
	throw new GitHubApiError(detail || `GitHub 请求失败（${response.status}）`, response.status)
}

function parseGitHubRepository(input: string) {
	const value = input.trim().replace(/\/$/, '').replace(/\.git$/, '')
	const match = value.match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+)$/i)
	if (!match) throw new Error('请输入 GitHub 仓库地址，例如 https://github.com/facebook/react')
	return { owner: match[1], repository: match[2] }
}

function createOverview(repository: GitHubRepository): RepositoryOverview {
	return {
		repositoryKind: 'git',
		displayName: repository.full_name,
		currentBranch: repository.default_branch,
		isDetachedHead: false,
		isBare: false,
		headHash: null,
		headShortHash: null,
		upstreamBranch: null,
		ahead: 0,
		behind: 0,
		hasStagedChanges: false,
		hasUnstagedChanges: false,
		hasUntrackedFiles: false,
		conflictedCount: 0,
		stashCount: 0,
		capabilities: { canExport: false, supportsStaging: false, supportsHistory: true, hasWorkingTree: false }
	}
}

function toGraphCommit(commit: GitHubCommit, branch: string | null, firstPage: boolean): GraphCommit {
	const author = commit.commit.author || commit.commit.committer
	return {
		hash: commit.sha,
		shortHash: commit.sha.slice(0, 7),
		author: commit.author?.login || author?.name || 'Unknown',
		timestampMs: author?.date ? Date.parse(author.date) : 0,
		message: commit.commit.message.split('\n', 1)[0],
		parentHashes: commit.parents.map(parent => parent.sha),
		refs: firstPage && branch ? [{ name: branch, kind: 'branch' }, { name: 'HEAD', kind: 'head' }] : [],
		isStash: false
	}
}

function matchesCommit(commit: GraphCommit, query: string) {
	if (!query) return true
	return [commit.hash, commit.author, commit.message, ...commit.refs.map(ref => ref.name)].some(value => value.toLocaleLowerCase().includes(query))
}

function toDiffFile(file: GitHubChangedFile, fileId: number): DiffFile {
	return {
		fileId,
		path: file.filename,
		oldPath: file.previous_filename || null,
		status: statusLabel(file.status),
		groups: ['all'],
		additions: file.additions,
		deletions: file.deletions,
		isBinary: isBinaryPath(file.filename),
		isSubmodule: false,
		previewTooLarge: false,
		exportTooLarge: false,
		hasConflictViews: false,
		nodeKind: 'file'
	}
}

function toRepositoryTreeEntry(content: GitHubContent): RepositoryTreeEntry {
	const kind = content.type === 'dir' ? 'directory' : content.type
	return {
		name: content.name,
		path: content.path,
		kind,
		size: kind === 'file' ? content.size : null,
		isBinary: kind === 'file' && isBinaryPath(content.path)
	}
}

function compareRepositoryEntries(left: RepositoryTreeEntry, right: RepositoryTreeEntry) {
	return repositoryEntryRank(left) - repositoryEntryRank(right) || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) || left.name.localeCompare(right.name)
}

function repositoryEntryRank(entry: RepositoryTreeEntry) {
	if (entry.kind === 'directory') return 0
	if (entry.kind === 'submodule') return 1
	if (entry.kind === 'file') return 2
	return 3
}

function summarize(entries: DiffEntry[]) {
	let filesAdded = 0
	let filesDeleted = 0
	let filesRenamed = 0
	let insertions = 0
	let deletions = 0
	for (const { file } of entries) {
		if (file.status === 'added') filesAdded += 1
		if (file.status === 'removed') filesDeleted += 1
		if (file.status === 'renamed') filesRenamed += 1
		insertions += file.additions
		deletions += file.deletions
	}
	return {
		filesChanged: entries.length,
		filesAdded,
		filesModified: entries.length - filesAdded - filesDeleted - filesRenamed,
		filesDeleted,
		filesRenamed,
		filesConflicted: 0,
		insertions,
		deletions
	}
}

function createPatch(file: GitHubChangedFile) {
	const oldPath = file.status === 'added' ? '/dev/null' : `a/${file.previous_filename || file.filename}`
	const newPath = file.status === 'removed' ? '/dev/null' : `b/${file.filename}`
	return `diff --git a/${file.previous_filename || file.filename} b/${file.filename}\n--- ${oldPath}\n+++ ${newPath}\n${file.patch || ''}\n`
}

function statusLabel(status: string) {
	if (status === 'added') return 'Added'
	if (status === 'removed') return 'Deleted'
	if (status === 'renamed') return 'Renamed'
	if (status === 'copied') return 'Copied'
	return 'Modified'
}

function isBinaryPath(path: string) {
	return /\.(?:7z|avi|bin|bmp|class|dll|docx?|eot|exe|gif|gz|ico|jpe?g|mkv|mov|mp3|mp4|otf|pdf|png|pptx?|rar|so|tar|tiff?|ttf|wav|webm|webp|woff2?|xlsx?|zip)$/i.test(path)
}

async function readBoundedText(response: Response) {
	const declaredSize = Number(response.headers.get('content-length') || 0)
	if (Number.isFinite(declaredSize) && declaredSize > SOURCE_LIMIT) throw new Error('文件超过 2 MiB，无法在线预览')
	const reader = response.body?.getReader()
	if (!reader) return decodeText(new Uint8Array(await response.arrayBuffer()))
	const chunks: Uint8Array[] = []
	let total = 0
	try {
		while (true) {
			const next = await reader.read()
			if (next.done) break
			total += next.value.byteLength
			if (total > SOURCE_LIMIT) {
				await reader.cancel()
				throw new Error('文件超过 2 MiB，无法在线预览')
			}
			chunks.push(next.value)
		}
	} finally {
		reader.releaseLock()
	}
	const bytes = new Uint8Array(total)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.byteLength
	}
	return decodeText(bytes)
}

function decodeText(bytes: Uint8Array) {
	if (bytes.byteLength > SOURCE_LIMIT) throw new Error('文件超过 2 MiB，无法在线预览')
	if (bytes.includes(0)) throw new Error('二进制文件无法在线预览')
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
	} catch {
		throw new Error('仅支持预览 UTF-8 文本文件')
	}
}

function normalizeRepositoryPath(path: string) {
	const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
	if (parts.some(part => part === '.' || part === '..')) throw new Error('仓库路径无效')
	return parts.join('/')
}

function nextLink(header: string | null) {
	if (!header) return null
	for (const part of header.split(',')) {
		const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/)
		if (match?.[2] === 'next') return match[1]
	}
	return null
}

function parseCursor(cursor: string | null) {
	if (cursor === null) return 0
	const value = Number(cursor)
	if (!Number.isSafeInteger(value) || value < 0) throw new Error('仓库分页游标无效')
	return value
}

function required<T>(value: T | null | undefined, message: string): T {
	if (value == null) throw new Error(message)
	return value
}
