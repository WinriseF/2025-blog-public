import type { GitRef } from '@/lib/version-control/types'

const priority: Record<GitRef['kind'], number> = { head: 0, branch: 1, 'deleted-branch': 2, tag: 3, stash: 4, 'remote-branch': 5 }

export function GitRefBadges({
	refs,
	maxVisible,
	size = 'default',
	wrap = true
}: {
	refs: GitRef[]
	maxVisible?: number
	size?: 'compact' | 'default'
	wrap?: boolean
}) {
	const sorted = [...refs].sort((left, right) => priority[left.kind] - priority[right.kind] || left.name.localeCompare(right.name))
	const visible = maxVisible ? sorted.slice(0, maxVisible) : sorted
	const hidden = sorted.length - visible.length
	const sizeClass = size === 'compact' ? 'px-1.5 py-[2px] text-[9px] leading-none' : 'px-2 py-1 text-[10px] leading-none'
	return (
		<div className={`flex min-w-0 gap-1.5 ${wrap ? 'flex-wrap' : 'flex-nowrap overflow-hidden'}`}>
			{visible.map((ref, index) => (
				<span
					key={`${ref.kind}-${ref.name}-${index}`}
					title={ref.name}
					className={`${sizeClass} inline-flex max-w-40 items-center truncate rounded-full border font-semibold ${badgeClass(ref.kind)}`}>
					{ref.kind === 'head' ? 'HEAD' : ref.name}
				</span>
			))}
			{hidden > 0 && <span className={`${sizeClass} border-border bg-background/60 text-secondary rounded-full border font-semibold`}>+{hidden}</span>}
		</div>
	)
}

function badgeClass(kind: GitRef['kind']) {
	switch (kind) {
		case 'head':
			return 'border-red-500/30 bg-red-500/15 text-red-400'
		case 'branch':
			return 'border-blue-500/30 bg-blue-500/15 text-blue-400'
		case 'deleted-branch':
			return 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400 border-dashed'
		case 'tag':
			return 'border-green-500/30 bg-green-500/15 text-green-400'
		case 'stash':
			return 'border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-400 border-dashed'
		default:
			return 'border-border bg-background/60 text-secondary'
	}
}
