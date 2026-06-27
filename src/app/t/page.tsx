import { ToolPageShell } from '../toolbox/tool-page-shell'
import { TransferPageClient } from './transfer-page-client'

export default function Page() {
	return (
		<ToolPageShell eyebrow='Transfer' title='快传' description='公网中转 / 局域网互传'>
			<TransferPageClient />
		</ToolPageShell>
	)
}
