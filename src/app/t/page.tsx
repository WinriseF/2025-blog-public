import { ToolPageShell } from '../toolbox/tool-page-shell'
import { TransferPageClient } from './transfer-page-client'

export default function Page() {
	return (
		<ToolPageShell mobileFlush>
			<TransferPageClient />
		</ToolPageShell>
	)
}
