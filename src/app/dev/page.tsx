import { ToolPageShell } from '@/app/toolbox/tool-page-shell'
import { LanBenchmarkClient } from './lan-benchmark-client'

export default function DevPage() {
	return (
		<ToolPageShell>
			<LanBenchmarkClient />
		</ToolPageShell>
	)
}
