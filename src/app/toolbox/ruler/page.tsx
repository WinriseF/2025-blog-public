import type { Metadata, Viewport } from 'next'
import { RulerTool } from './ruler-tool'

export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 5, userScalable: true, viewportFit: 'cover' }

export const metadata: Metadata = {
	title: '屏幕尺子 · WinriseF',
	description: '校准屏幕上的真实长度，用毫米与厘米刻度测量小物件。支持电脑和手机，校准数据保存在本机。'
}

export default function Page() {
	return <RulerTool />
}
