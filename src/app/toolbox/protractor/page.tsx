import type { Metadata, Viewport } from 'next'
import { Protractor } from './protractor'

export const metadata: Metadata = {
	title: '量角器 · WinriseF',
	description: '拖动量角器测量夹角，支持桌面悬浮小窗和手机摄像头取景，无需校准。'
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' }

export default function Page() {
	return <Protractor />
}
