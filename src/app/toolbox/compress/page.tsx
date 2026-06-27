import { CompressTool } from '../compress-tool'
import { ToolPageShell } from '../tool-page-shell'

export default function Page() {
	return (
		<ToolPageShell eyebrow='Compress' title='图片压缩' description='PNG / JPG 转 WEBP'>
			<CompressTool />
		</ToolPageShell>
	)
}
