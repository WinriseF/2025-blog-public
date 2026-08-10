import type { CodexRecord } from './record-utils'
import type { SourceRef } from './types'

export type RecordEnvelope = {
	sequence: number
	sourceRef: SourceRef
	record?: CodexRecord
	parseError?: string
}
