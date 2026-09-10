import { readPart, type Entry } from './zip'

const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const TYPE_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const OFFICE_REL = ['http://schemas.openxmlformats.org/officeDocument/2006/relationships/', 'http://purl.oclc.org/ooxml/officeDocument/relationships/']
export const OFFICE_TYPES = {
	pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
} as const
export type OfficeFormat = keyof typeof OFFICE_TYPES

export function officeFormat(name: string): OfficeFormat {
	const extension = name.split('.').pop()?.toLowerCase()
	if (extension !== 'pptx' && extension !== 'docx' && extension !== 'xlsx') throw new Error('仅支持 PPTX、DOCX、XLSX；请先将旧版 Office 文件另存为现代格式')
	return extension
}

export function resolveTarget(owner: string, target: string) {
	if (!target || /[\\?#\x00-\x20]/.test(target) || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) throw new Error('文档包含非法内部引用')
	const base = target.startsWith('/') ? [] : owner.split('/').slice(0, -1)
	for (const encoded of target.replace(/^\//, '').split('/')) {
		const part = decodeURIComponent(encoded)
		if (/[\\/\x00-\x1f]/.test(part)) throw new Error('文档包含非法路径')
		if (part === '..') {
			if (!base.length) throw new Error('文档引用越过文件根目录')
			base.pop()
		} else if (part && part !== '.') base.push(part)
	}
	return base.join('/')
}

function parseXml(text: string, root: string, namespace: string) {
	if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('不支持含实体声明的 Office 文件')
	const xml = new DOMParser().parseFromString(text, 'application/xml')
	if (xml.getElementsByTagName('parsererror').length || xml.documentElement.localName !== root || xml.documentElement.namespaceURI !== namespace) throw new Error('Office 文件内部 XML 损坏')
	return xml
}

export async function inspectPackage(entries: Entry[], format: OfficeFormat, signal: AbortSignal) {
	const files = new Map<string, Entry>()
	const names = new Set<string>()
	for (const entry of entries) {
		const name = entry.filename
		const key = resolveTarget('', name)
		if (name.startsWith('/') || names.has(key.toLowerCase()) || key !== name.replace(/\/$/, '')) throw new Error('Office 文件包含重复或异常路径')
		names.add(key.toLowerCase())
		if (entry.encrypted) throw new Error('暂不支持加密的 Office 文件')
		if (key.toLowerCase().startsWith('_xmlsignatures/')) throw new Error('该文档带有数字签名，压缩会使签名失效')
		if (![0, 8].includes(entry.compressionMethod)) throw new Error('文档使用了不支持的 ZIP 压缩方式')
		if (!entry.directory) files.set(name, entry)
	}
	let xmlBytes = 0
	const readXml = async (name: string) => {
		const entry = files.get(name)
		if (!entry) throw new Error(`Office 文件缺少 ${name}`)
		xmlBytes += entry.uncompressedSize
		if (xmlBytes > 64 * 1024 * 1024) throw new Error('Office 文件关系信息过大')
		const blob = await readPart(entry, signal, 16 * 1024 * 1024)
		const bytes = new Uint8Array(await blob.arrayBuffer())
		const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8'
		return new TextDecoder(encoding, { fatal: true }).decode(bytes)
	}
	const types = parseXml(await readXml('[Content_Types].xml'), 'Types', TYPE_NS)
	const defaults = new Map<string, string>()
	const overrides = new Map<string, string>()
	for (const node of Array.from(types.documentElement.children)) {
		if (node.namespaceURI !== TYPE_NS) throw new Error('无效的 Office 内容类型')
		const type = node.getAttribute('ContentType') ?? ''
		if (/digital-signature|macroEnabled|vbaProject/i.test(type)) throw new Error('暂不支持带宏或数字签名的文档')
		if (!type) throw new Error('文档缺少内容类型')
		if (node.localName === 'Default') {
			const extension = (node.getAttribute('Extension') ?? '').toLowerCase()
			if (!extension || defaults.has(extension)) throw new Error('文档内容类型声明重复或无效')
			defaults.set(extension, type)
		} else if (node.localName === 'Override') {
			const path = resolveTarget('', node.getAttribute('PartName') ?? '')
			if (overrides.has(path)) throw new Error('文档内容类型声明重复')
			overrides.set(path, type)
		} else throw new Error('无效的 Office 内容类型声明')
	}
	const contentType = (name: string) => overrides.get(name) ?? defaults.get(name.split('.').pop()!.toLowerCase()) ?? ''
	const images = new Map<string, string>()
	let validMain = false
	for (const name of files.keys()) {
		if (!name.endsWith('.rels')) continue
		signal.throwIfAborted()
		const owner = name === '_rels/.rels' ? '' : name.replace(/(^|\/)_rels\/([^/]+)\.rels$/, '$1$2')
		if (owner === name || (owner && !files.has(owner))) throw new Error('Office 文件关系路径异常')
		const xml = parseXml(await readXml(name), 'Relationships', REL_NS)
		const ids = new Set<string>()
		for (const node of Array.from(xml.documentElement.children)) {
			if (node.localName !== 'Relationship' || node.namespaceURI !== REL_NS) throw new Error('Office 文件关系格式异常')
			const id = node.getAttribute('Id') ?? ''
			if (!id || ids.has(id)) throw new Error('Office 文件存在重复关系 ID')
			ids.add(id)
			const type = node.getAttribute('Type') ?? ''
			if (type.includes('digital-signature')) throw new Error('该文档带有数字签名，无法压缩')
			const image = OFFICE_REL.some(prefix => type === prefix + 'image')
			const mode = node.getAttribute('TargetMode') ?? 'Internal'
			if (mode === 'External') continue
			if (mode !== 'Internal') throw new Error('文档包含无效引用模式')
			const target = resolveTarget(owner, node.getAttribute('Target') ?? '')
			if (!files.has(target)) throw new Error(`文档引用的资源不存在：${target}`)
			if (!owner && OFFICE_REL.some(prefix => type === prefix + 'officeDocument')) {
				if (validMain || contentType(target) !== OFFICE_TYPES[format]) throw new Error('文件扩展名与 Office 实际类型不一致')
				validMain = true
			}
			if (image) {
				if (!contentType(target).startsWith('image/')) throw new Error('图片引用与文件内容类型不一致')
				images.set(target, contentType(target))
				if (images.size > 10_000) throw new Error('文档图片数量过多')
			}
		}
	}
	if (!validMain) throw new Error('不是可识别的 Office Open XML 文件')
	return images
}
