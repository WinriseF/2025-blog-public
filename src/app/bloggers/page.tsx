'use client'

import GridView, { type Blogger } from './grid-view'
import initialList from './list.json'

export default function Page() {
	const bloggers = initialList as Blogger[]

	return <GridView bloggers={bloggers} />
}
