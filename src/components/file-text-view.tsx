'use client'

import { useMemo } from 'react'
import { File as PierreFile, Virtualizer } from '@pierre/diffs/react'
import type { FileContents } from '@pierre/diffs'
import type { DiffThemeDefinition } from '@/app/toolbox/version-control/diff-themes'

export function FileTextView({ file, theme }: { file: FileContents; theme: DiffThemeDefinition }) {
	const fileOptions = useMemo(
		() => ({
			theme: theme.shiki,
			themeType: theme.type,
			overflow: 'wrap' as const,
			disableFileHeader: true,
			stickyHeader: false,
			// Single-theme Pierre output sets a literal host background as well as variables.
			unsafeCSS: ':host { background-color: transparent; --diffs-bg: transparent; --diffs-light-bg: transparent; --diffs-dark-bg: transparent; }'
		}),
		[theme.shiki, theme.type]
	)
	return (
		<Virtualizer className='min-h-0 flex-1 overflow-auto [background-color:var(--diff-background)]' contentClassName='min-h-full'>
			<PierreFile file={file} options={fileOptions} />
		</Virtualizer>
	)
}
