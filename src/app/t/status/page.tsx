import { ToolPageShell } from '../../toolbox/tool-page-shell'
import { TransferStatusClient } from './status-client'

export default function Page() {
	return (
		<ToolPageShell>
			<TransferStatusClient />
		</ToolPageShell>
	)
}
