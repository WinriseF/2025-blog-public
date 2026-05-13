import type { Metadata } from 'next'
import GameClient from './game-client'

export const metadata: Metadata = {
	title: '弹弹弹 | WinriseF',
	description: '一个会越打越密的多球打砖块小游戏。'
}

export default function GamePage() {
	return <GameClient />
}
