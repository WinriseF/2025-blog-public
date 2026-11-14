import Fuse from 'fuse.js'
import catalog from '@/data/ruler-references.json'

export type RulerReference = {
	id: string
	category: 'phone' | 'identity' | 'card' | 'connector' | 'memory'
	name: string
	brand?: string
	region: string
	heightMm: number
	widthMm: number
	note?: string
	sources: string[]
}

export const referenceBrands = catalog.brands
export const rulerReferences = catalog.references as RulerReference[]

function normalize(value: string) {
	return value
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]/gu, '')
}

function referenceSearchFields(reference: RulerReference) {
	let brand = referenceBrands.find(item => item.id === reference.brand)?.label || ''
	// Child brands must not make every sibling model match REDMI, POCO, or iQOO.
	if (reference.brand === 'xiaomi') brand = `小米 Xiaomi ${/^redmi/i.test(reference.name) ? '红米 REDMI' : ''}`
	if (reference.brand === 'vivo') brand = 'vivo'
	if (reference.brand === 'lenovo') brand = `联想 Lenovo ${/^moto/i.test(reference.name) ? '摩托罗拉 Motorola moto' : ''}`
	return [reference.name, brand, reference.region, reference.note || ''].map(normalize)
}

const searchEntries = [
	...rulerReferences.map(reference => ({ reference, mode: null, fields: referenceSearchFields(reference) })),
	{ reference: null, mode: 'ruler', fields: ['实体尺', '毫米尺', 'ruler'] },
	{ reference: null, mode: 'custom', fields: ['自定义参照物', '已知长度', '纸张', 'custom'] }
]
const referenceSearch = new Fuse(searchEntries, {
	keys: ['fields'],
	isCaseSensitive: false,
	ignoreDiacritics: true,
	ignoreLocation: true,
	ignoreFieldNorm: true,
	includeScore: true,
	threshold: 0.3,
	useTokenSearch: true,
	tokenMatch: 'all'
})

export function searchReferences(query: string) {
	const terms = query.normalize('NFKC').trim().split(/\s+/).map(normalize).filter(Boolean)
	if (!terms.length) return { references: rulerReferences, showRuler: true, showCustom: true }
	const modelNumbers = terms.flatMap(term => term.match(/\d{2,}/g) || [])
	const results = referenceSearch
		.search(terms.join(' '))
		.filter(({ item }) => {
			if (item.reference?.category !== 'phone') return true
			// Fuzzy spelling should not turn a requested model 14 into model 15.
			const numbers: string[] = item.reference.name.match(/\d+/g) || []
			return modelNumbers.every(number => numbers.includes(number))
		})
		.map(result => ({ ...result, exact: terms.every(term => result.item.fields.some(field => field.includes(term))) }))
		.sort((a, b) => Number(b.exact) - Number(a.exact) || (a.score || 0) - (b.score || 0))
	return {
		references: results.flatMap(({ item }) => (item.reference ? [item.reference] : [])),
		showRuler: results.some(({ item }) => item.mode === 'ruler'),
		showCustom: results.some(({ item }) => item.mode === 'custom')
	}
}

export function referenceLengths(reference: RulerReference, axis: 'width' | 'height') {
	if (reference.category === 'connector') return [reference.widthMm, reference.widthMm, reference.widthMm] as const
	if (reference.category === 'phone') {
		const length = axis === 'width' ? reference.widthMm : reference.heightMm
		// A phone's long edge may not fit on another phone's display. Repeat the selected edge.
		return [length, length, length] as const
	}
	return [
		Math.max(reference.heightMm, reference.widthMm),
		Math.max(reference.heightMm, reference.widthMm),
		Math.min(reference.heightMm, reference.widthMm)
	] as const
}
