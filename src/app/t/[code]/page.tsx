import { ToolPageShell } from '../../toolbox/tool-page-shell'
import { TransferPageClient } from '../transfer-page-client'

type TransferPageContext = {
	params: Promise<{
		code: string
	}>
}

export default async function Page({ params }: TransferPageContext) {
	const { code } = await params
	return (
		<ToolPageShell eyebrow='Transfer' title='快传' description='公网中转 / 局域网互传'>
			<TransferPageClient initialCode={code} />
		</ToolPageShell>
	)
}
