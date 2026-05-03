import type { Metadata } from 'next'
import WorldClockClient from './world-clock-client'

export const metadata: Metadata = {
	title: '世界时钟',
	description: '在球形地图上查看标准时间与太阳时'
}

export default function WorldClockPage() {
	return <WorldClockClient />
}
