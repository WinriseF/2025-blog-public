import type { Metadata } from 'next'
import MusicClient from './music-client'

export const metadata: Metadata = {
	title: '私人电台',
	description: '选择并播放站点音乐列表中的歌曲'
}

export default function MusicPage() {
	return <MusicClient />
}
