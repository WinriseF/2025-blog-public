import { OcrTool } from '../ocr-tool'
import { ToolPageShell } from '../tool-page-shell'

export default function Page() {
	return (
		<ToolPageShell mobileFlush>
			<OcrTool />
		</ToolPageShell>
	)
}
