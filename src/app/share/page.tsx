'use client'

import GridView from './grid-view'
import initialList from './list.json'
import type { Share } from './components/share-card'

export default function Page() {
	const shares = initialList as Share[]

	return <GridView shares={shares} />
}
