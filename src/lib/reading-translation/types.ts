export type TranslationTarget = {
	text: string
	context: string
	contextOffset: number
	mode: 'word' | 'passage'
}

export type ReadingSelection = TranslationTarget & {
	range: Range
}

export type TranslationConfig = {
	endpoint: string
	model: string
	apiKey: string
}

export type TranslationResult = {
	translation: string
	lemma?: string
	partOfSpeech?: string
	note?: string
}

export type TranslationState = {
	status: 'idle' | 'loading' | 'success' | 'error' | 'unconfigured'
	result?: TranslationResult
	message?: string
}
