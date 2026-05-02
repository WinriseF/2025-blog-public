const originalWarn = console.warn
const staleBaselineMessage = '[baseline-browser-mapping] The data in this module is over two months old.'

console.warn = (...args) => {
	const message = args.map(arg => (typeof arg === 'string' ? arg : String(arg))).join(' ')
	if (message.includes(staleBaselineMessage)) return
	originalWarn(...args)
}
