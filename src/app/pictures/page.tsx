import type { Metadata } from 'next'
import { GalleryWall } from './components/gallery-wall'
import pictures from './list.json'

export const metadata: Metadata = { title: '画廊 · WinriseF', description: '挂在收藏墙上的影像与图集。' }

export default function Page() {
	return <GalleryWall pictures={pictures} />
}
