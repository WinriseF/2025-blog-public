import type { GraphCommit } from './types'

export type DisplayGraphCommit = GraphCommit & {
	displayKind: 'commit' | 'stash'
}

export type SwimlaneNode = { id: string; color: string }

export type CommitRowViewModel = {
	commit: DisplayGraphCommit
	inputSwimlanes: SwimlaneNode[]
	outputSwimlanes: SwimlaneNode[]
	circleIndex: number
	circleColor: string
}

const GRAPH_COLORS = ['#89b4fa', '#a6e3a1', '#f9e2af', '#f38ba8', '#cba6f7', '#fab387', '#94e2d5', '#f5c2e7']

export function buildGitGraphDisplayCommits(commits: GraphCommit[]): DisplayGraphCommit[] {
	const hiddenCommitHashes = new Set<string>()
	const availableCommitHashes = new Set(commits.map(commit => commit.hash))
	const displayCommits: DisplayGraphCommit[] = []

	for (const commit of commits) {
		if (hiddenCommitHashes.has(commit.hash)) continue
		if (!commit.isStash || commit.parentHashes.length === 0) {
			displayCommits.push({ ...commit, displayKind: 'commit' })
			continue
		}
		const baseHash = commit.parentHashes[0]
		const collapsedHashes = commit.parentHashes.slice(1)
		for (const hash of collapsedHashes) if (availableCommitHashes.has(hash)) hiddenCommitHashes.add(hash)
		displayCommits.push({
			...commit,
			displayKind: 'stash',
			parentHashes: [baseHash]
		})
	}
	return displayCommits
}

export function computeGitGraphLayout(commits: DisplayGraphCommit[]) {
	const commitHashes = new Set(commits.map(commit => commit.hash))
	const rows: CommitRowViewModel[] = []
	let colorIndex = 0

	for (const commit of commits) {
		const parents = commit.parentHashes.filter(parentHash => commitHashes.has(parentHash))
		const previousOutput = rows.length > 0 ? rows[rows.length - 1].outputSwimlanes : []
		const inputSwimlanes = previousOutput.map(node => ({ ...node }))
		const outputSwimlanes: SwimlaneNode[] = []
		let firstParentAdded = false

		for (const node of inputSwimlanes) {
			if (node.id === commit.hash) {
				if (parents.length > 0 && !firstParentAdded) {
					outputSwimlanes.push({ id: parents[0], color: node.color })
					firstParentAdded = true
				}
				continue
			}
			outputSwimlanes.push({ ...node })
		}

		for (let index = firstParentAdded ? 1 : 0; index < parents.length; index += 1) {
			outputSwimlanes.push({ id: parents[index], color: GRAPH_COLORS[colorIndex % GRAPH_COLORS.length] })
			colorIndex += 1
		}

		const inputIndex = inputSwimlanes.findIndex(node => node.id === commit.hash)
		const circleIndex = inputIndex !== -1 ? inputIndex : inputSwimlanes.length
		const circleColor =
			circleIndex < outputSwimlanes.length
				? outputSwimlanes[circleIndex].color
				: circleIndex < inputSwimlanes.length
					? inputSwimlanes[circleIndex].color
					: GRAPH_COLORS[0]

		rows.push({ commit: { ...commit, parentHashes: parents }, inputSwimlanes, outputSwimlanes, circleIndex, circleColor })
	}

	return { rows }
}

export function isCollapsedStashCommit(commit: DisplayGraphCommit) {
	return commit.displayKind === 'stash'
}
