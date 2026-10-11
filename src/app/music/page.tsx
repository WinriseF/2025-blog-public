import type { Metadata } from 'next'
import MusicClient from './music-client'

export const metadata: Metadata = {
	title: '音乐仓',
	description: '让日常，慢半拍。在音乐仓听一首喜欢的歌。'
}

export default function MusicPage() {
	return <MusicClient />
}
