import type { Metadata } from 'next'
import { AgentPageClient, type AgentRegistrationState } from './agent-page-client'

export const metadata: Metadata = {
	title: 'WinriseF Toolbox Agent',
	description: '连接浏览器与 Windows 本机能力的便携组件中心'
}

type AgentPageContext = {
	searchParams: Promise<{
		'agent-ready'?: string | string[]
	}>
}

export default async function AgentPage({ searchParams }: AgentPageContext) {
	const params = await searchParams
	const readyParam = Array.isArray(params['agent-ready']) ? params['agent-ready'][0] : params['agent-ready']
	const initialStatus: AgentRegistrationState = readyParam === undefined ? 'idle' : readyParam === '1' ? 'ready' : 'failed'

	return <AgentPageClient initialStatus={initialStatus} />
}
