import { expect, test, type Page } from '@playwright/test'

async function setCardLength(page: Page, pixels: number) {
	const handle = page.getByRole('button', { name: '拖动调整参照线' })
	await expect(handle).toBeEnabled()
	await handle.scrollIntoViewIfNeeded()
	const line = (await page.getByTestId('calibration-line').boundingBox())!
	const box = (await handle.boundingBox())!
	const vertical = line.height > line.width
	const delta = pixels - (vertical ? line.height : line.width)
	const x = box.x + box.width / 2,
		y = box.y + box.height / 2
	const target = { x: x + (vertical ? 0 : delta), y: y + (vertical ? delta : 0) }
	if (await page.evaluate(() => navigator.maxTouchPoints > 0)) {
		const client = await page.context().newCDPSession(page)
		await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
		await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [target] })
		await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
		await client.detach()
	} else {
		await page.mouse.move(x, y)
		await page.mouse.down()
		await page.mouse.move(target.x, target.y, { steps: 4 })
		await page.mouse.up()
	}
	await expect
		.poll(async () => {
			const bounds = (await page.getByTestId('calibration-line').boundingBox())!
			return Math.abs(Math.max(bounds.width, bounds.height) - pixels)
		})
		.toBeLessThan(1)
	const after = (await page.getByTestId('calibration-line').boundingBox())!
	expect(Math.abs((vertical ? after.y : after.x) - (vertical ? line.y : line.x))).toBeLessThan(0.1)
}

async function calibrateCard(page: Page, scale = 4) {
	await page.getByRole('button', { name: '开始校准', exact: true }).click()
	await expect(page.getByRole('heading', { name: '选择校准参照物' })).toBeVisible()
	await expect(page.getByTestId('calibration-line')).toHaveCount(0)
	await page.getByRole('button', { name: '银行卡', exact: true }).click()
	for (const [index, mm] of [85.6, 85.6, 53.98].entries()) {
		await expect(page.getByText(`第 ${index + 1} / 3 步`, { exact: false })).toBeVisible()
		await setCardLength(page, Math.round(mm * scale * 2) / 2)
		await page.getByRole('button', { name: '已对齐，继续' }).click()
	}
	await page.getByRole('button', { name: '保存校准，开始测量' }).click()
	await expect(page.getByTestId('measurement')).toHaveText('5.00')
}

for (const [name, width, height, mobile] of [
	['desktop', 1440, 900, false],
	['phone', 390, 844, true],
	['small', 320, 568, true],
	['landscape', 844, 390, true]
] as const) {
	test(`${name}: calibration, layout and measurement controls`, async ({ browser }) => {
		const context = await browser.newContext({ viewport: { width, height }, screen: { width, height }, isMobile: mobile, hasTouch: mobile })
		const page = await context.newPage()
		const errors: string[] = []
		page.on('pageerror', error => errors.push(error.message))
		await page.goto('/toolbox/ruler')
		await expect(page.getByTestId('measurement')).toHaveText('—')
		if (name === 'small') {
			await page.getByRole('button', { name: '开始校准', exact: true }).click()
			await page.getByRole('button', { name: '实体尺', exact: true }).click()
			for (let i = 0; i < 4; i++) {
				const length = await page.getByTestId('calibration-line').evaluate(el => Math.max(el.getBoundingClientRect().width, el.getBoundingClientRect().height))
				await page.getByLabel('实测长度').fill(String(length / 4))
				await page.getByRole('button', { name: '确认读数，继续' }).click()
			}
			await page.getByRole('button', { name: '保存校准，开始测量' }).click()
		} else await calibrateCard(page)
		await expect(page.getByTestId('measurement')).toHaveText('5.00')
		// Physical ticks must touch viewport edges, independent of the inner controls.
		const board = page.getByTestId('ruler-board')
		expect(await board.boundingBox()).toEqual({ x: 0, y: 0, width, height })
		for (let direction = 0; direction < 2; direction++) {
			const geometry = await board.evaluate(el => {
				const vertical = el.getAttribute('data-vertical') === 'true'
				const lines = el.querySelectorAll('svg line')
				return {
					start: Number(lines[0].getAttribute(vertical ? 'x1' : 'y1')),
					end: Number(lines[1].getAttribute(vertical ? 'x2' : 'y2')),
					size: vertical ? innerWidth : innerHeight
				}
			})
			expect(geometry.start).toBe(0)
			expect(geometry.end).toBe(geometry.size)
			await page.getByRole('button', { name: '切换横竖方向' }).click()
		}
		await page.screenshot({ path: `/tmp/screen-ruler-qa/${name}-ready.png` })
		expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true)
		const end = page.getByRole('slider', { name: '终点 B' })
		await end.focus()
		await page.keyboard.press('ArrowDown')
		await expect(page.getByTestId('measurement')).toHaveText('5.10')
		await page.getByRole('button', { name: '锁定标记' }).click()
		await end.press('ArrowDown')
		await expect(page.getByTestId('measurement')).toHaveText('5.10')
		await expect(page.getByRole('button', { name: '标记前进 0.1 毫米' })).toBeDisabled()
		await page.getByRole('button', { name: '解锁标记' }).click()
		await page.getByRole('button', { name: '标记前进 0.1 毫米' }).click()
		await expect(page.getByTestId('measurement')).toHaveText('5.11')
		await page.getByRole('button', { name: '英寸', exact: true }).click()
		await expect(page.getByTestId('measurement')).toHaveText('2.012')
		await page.reload()
		await expect(page.getByTestId('measurement')).toHaveText('4.00')
		expect(errors).toEqual([])
		await context.close()
	})
}

test('rejects inconsistent card matching and independent ruler verification', async ({ page }) => {
	await page.goto('/toolbox/ruler')
	await page.getByRole('button', { name: '开始校准', exact: true }).click()
	await page.getByRole('button', { name: '银行卡', exact: true }).click()
	await setCardLength(page, 342.5)
	await page.getByRole('button', { name: '已对齐，继续' }).click()
	await setCardLength(page, 380)
	await page.getByRole('button', { name: '已对齐，继续' }).click()
	await expect(page.getByRole('dialog').getByRole('alert')).toContainText('相差超过')
	await page.getByRole('button', { name: '返回选择参照物' }).click()
	await expect(page.getByRole('heading', { name: '选择校准参照物' })).toBeVisible()
	await expect(page.getByTestId('calibration-line')).toHaveCount(0)
	await page.getByRole('button', { name: '实体尺', exact: true }).click()
	for (let i = 0; i < 3; i++) {
		const length = await page.getByTestId('calibration-line').evaluate(el => Math.max(el.getBoundingClientRect().width, el.getBoundingClientRect().height))
		await page.getByLabel('实测长度').fill(String(length / 5))
		await page.getByRole('button', { name: '确认读数，继续' }).click()
	}
	const length = await page.getByTestId('calibration-line').evaluate(el => Math.max(el.getBoundingClientRect().width, el.getBoundingClientRect().height))
	await page.getByLabel('实测长度').fill(String(length / 5 + 5))
	await page.getByRole('button', { name: '确认读数，继续' }).click()
	await expect(page.getByRole('dialog').getByRole('alert')).toContainText('偏差超过')
	// Showing an error must not resize the physical reference line.
	expect(await page.getByTestId('calibration-line').evaluate(el => Math.max(el.getBoundingClientRect().width, el.getBoundingClientRect().height))).toBe(length)
	await page.getByLabel('实测长度').fill(String(length / 5))
	await page.getByRole('button', { name: '确认读数，继续' }).click()
	await page.getByRole('button', { name: '保存校准，开始测量' }).click()
	await expect(page.getByTestId('measurement')).toHaveText('5.00')
})

test('touch drag, pinch zoom and changed DPR never silently change effective measurement', async ({ browser }) => {
	const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
	const page = await context.newPage()
	await page.goto('/toolbox/ruler')
	await calibrateCard(page)
	const client = await context.newCDPSession(page)
	const bounds = (await page.getByRole('slider', { name: '终点 B' }).boundingBox())!
	const x = bounds.x + bounds.width / 2,
		y = bounds.y + bounds.height / 2
	await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
	await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + 40 }] })
	await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
	await expect(page.getByTestId('measurement')).toHaveText('6.00')
	await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.5 })
	await expect(page.getByTestId('measurement')).toHaveText('—')
	await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
	await expect(page.getByTestId('measurement')).toHaveText('6.00')
	await page.evaluate(() => {
		Object.defineProperty(window, 'devicePixelRatio', { value: 2 })
		window.dispatchEvent(new Event('resize'))
	})
	await expect(page.getByTestId('measurement')).toHaveText('—')
	await context.close()
})

for (const [name, width, height, mobile] of [
	['desktop', 1440, 900, false],
	['phone', 390, 844, true],
	['small', 320, 568, true],
	['landscape', 844, 390, true]
] as const) {
	test(`${name}: searches official phone sizes and calibrates with body width`, async ({ browser }) => {
		const context = await browser.newContext({ viewport: { width, height }, screen: { width, height }, isMobile: mobile, hasTouch: mobile })
		const page = await context.newPage()
		await page.goto('/toolbox/ruler')
		await page.getByRole('button', { name: '开始校准', exact: true }).click()
		await expect(page.getByRole('button', { name: '手机', exact: true })).toHaveAttribute('aria-expanded', 'false')
		await expect(page.getByRole('button', { name: /^iPhone 14 国际版/ })).toHaveCount(0)
		await page.getByRole('button', { name: '手机', exact: true }).click()
		await expect(page.getByRole('button', { name: '苹果 Apple', exact: true })).toBeVisible()
		await expect(page.getByRole('button', { name: /^iPhone 14 国际版/ })).toHaveCount(0)
		await page.getByRole('button', { name: '苹果 Apple', exact: true }).click()
		await expect(page.getByRole('button', { name: /^iPhone 14 国际版/ })).toBeVisible()
		await page.getByRole('button', { name: '苹果 Apple', exact: true }).click()
		await expect(page.getByRole('button', { name: /^iPhone 14 国际版/ })).toHaveCount(0)
		await page.getByLabel('搜索校准参照物').fill('iphone14')
		await page.getByRole('button', { name: /^iPhone 14 国际版/ }).click()
		await expect(page.getByRole('link', { name: '官方尺寸来源', exact: true })).toHaveAttribute('href', 'https://www.apple.com/iphone/compare/')
		await expect(page.getByText('71.5 mm', { exact: true })).toBeVisible()
		await page.getByRole('button', { name: '机身长度', exact: true }).click()
		await expect(page.getByText('146.7 mm', { exact: true })).toBeVisible()
		await page.getByRole('button', { name: '机身宽度', exact: true }).click()
		for (let step = 0; step < 3; step++) {
			await setCardLength(page, 286)
			await page.getByRole('button', { name: '已对齐，继续' }).click()
		}
		await page.getByRole('button', { name: '保存校准，开始测量' }).click()
		await expect(page.getByTestId('measurement')).toHaveText('5.00')
		const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('winrisef:screen-ruler:v2')!))
		expect(saved).toMatchObject({ method: 'phone', referenceId: 'apple-iphone-14' })
		expect(saved.pxPerMm).toBeCloseTo(4, 3)
		expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true)
		await context.close()
	})
}

test('selects a country-specific identity card and preserves expanded groups and search on return', async ({ page }) => {
	await page.goto('/toolbox/ruler')
	await page.getByRole('button', { name: '开始校准', exact: true }).click()
	await page.getByRole('button', { name: '身份证 / 证件', exact: true }).click()
	await page.getByLabel('搜索校准参照物').fill('中国居民')
	await page.getByRole('button', { name: /^中国居民身份证/ }).click()
	await page.getByRole('button', { name: '返回选择参照物' }).click()
	await expect(page.getByLabel('搜索校准参照物')).toHaveValue('中国居民')
	await expect(page.getByRole('button', { name: '身份证 / 证件', exact: true })).toHaveAttribute('aria-expanded', 'true')
	await page.getByRole('button', { name: /^中国居民身份证/ }).click()
	for (const mm of [85.6, 85.6, 54]) {
		await expect(page.getByText(`${mm} mm`, { exact: true })).toBeVisible()
		await setCardLength(page, mm * 4)
		await page.getByRole('button', { name: '已对齐，继续' }).click()
	}
	await page.getByRole('button', { name: '保存校准，开始测量' }).click()
	await expect(page.getByTestId('measurement')).toHaveText('5.00')
})

for (const [device, width, height, mobile] of [
	['desktop', 1440, 900, false],
	['phone', 390, 844, true]
] as const) {
	for (const [query, id, mm] of [
		['U盘', 'usb-a-plug', 12],
		['type c', 'usb-c-plug', 8.25]
	] as const) {
		test(`${device}: USB calibration ${id} supports small widths and persists`, async ({ browser }) => {
			const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile })
			const page = await context.newPage()
			await page.goto('/toolbox/ruler')
			await page.getByRole('button', { name: '开始校准', exact: true }).click()
			await expect(page.getByRole('button', { name: 'USB 插头', exact: true })).toHaveAttribute('aria-expanded', 'false')
			await page.getByLabel('搜索校准参照物').fill(query)
			await page.getByRole('button', { name: id === 'usb-a-plug' ? /^USB-A 插头/ : /^USB-C \/ Type-C 插头/ }).click()
			await expect(page.getByText(/仅对齐插入端/)).toContainText('可能不够准确')
			for (let step = 0; step < 3; step++) {
				await expect(page.getByText(`${mm} mm`, { exact: true })).toBeVisible()
				await setCardLength(page, mm * 4)
				await page.getByRole('button', { name: '已对齐，继续' }).click()
			}
			await expect(page.getByText('参照物较小，校准可能不够准确。', { exact: true })).toBeVisible()
			await page.getByRole('button', { name: '保存校准，开始测量' }).click()
			await expect(page.getByTestId('measurement')).toHaveText('5.00')
			await page.reload()
			await expect(page.getByTestId('measurement')).toHaveText('4.00')
			await expect(page.getByText(/USB 校准 · 可能不够准确/)).toBeVisible()
			const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('winrisef:screen-ruler:v2')!))
			expect(saved).toMatchObject({ method: 'connector', referenceId: id })
			// Browser layout rounds tiny reference lengths to subpixels.
			expect(Math.abs(saved.pxPerMm - 4) * mm).toBeLessThan(1 / 32)
			await context.close()
		})
	}
}

for (const [device, width, height, mobile] of [
	['desktop', 1440, 900, false],
	['phone', 390, 844, true],
	['small', 320, 568, true],
	['landscape', 844, 390, true]
] as const) {
	test(`${device}: custom reference accepts known length after dragging and restores calibration`, async ({ browser }) => {
		const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile })
		const page = await context.newPage()
		await page.goto('/toolbox/ruler')
		await page.getByRole('button', { name: '开始校准', exact: true }).click()
		await expect(page.getByRole('button', { name: '自定义参照物', exact: true })).not.toHaveAttribute('aria-expanded')
		await page.getByLabel('搜索校准参照物').fill('纸张')
		await page.getByRole('button', { name: '自定义参照物', exact: true }).click()
		const save = page.getByRole('button', { name: '保存校准，开始测量' })
		await expect(save).toBeDisabled()
		const targetPixels = Math.max(width, height) * 0.9
		await setCardLength(page, targetPixels)
		const before = await page.getByTestId('calibration-line').boundingBox()
		await page.getByLabel('实际长度').fill('0')
		await expect(save).toBeDisabled()
		await page.getByLabel('实际长度').fill('100000')
		await save.click()
		await expect(page.getByRole('dialog').getByRole('alert')).toContainText('请输入有效的实际长度')
		await page.getByLabel('实际长度').fill(String(targetPixels / 4))
		expect(await page.getByTestId('calibration-line').boundingBox()).toEqual(before)
		await expect(save).toBeInViewport()
		await expect(page.getByLabel('实际长度')).toBeInViewport()
		expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true)
		await save.click()
		await expect(page.getByTestId('measurement')).toHaveText('5.00')
		await page.reload()
		await expect(page.getByTestId('measurement')).toHaveText('4.00')
		await expect(page.getByText(/mm · 自定义长度校准/)).toBeVisible()
		const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('winrisef:screen-ruler:v2')!))
		expect(saved).toMatchObject({ method: 'custom', checkErrorMm: null })
		expect(saved.pxPerMm).toBeCloseTo(4, 3)
		await context.close()
	})
}

test('USB repeated alignment and independent check accept 1.5% but reject over 2%', async ({ page }) => {
	await page.goto('/toolbox/ruler')
	await page.getByRole('button', { name: '开始校准', exact: true }).click()
	await page.getByLabel('搜索校准参照物').fill('type c')
	await page.getByRole('button', { name: /^USB-C \/ Type-C 插头/ }).click()
	await setCardLength(page, 33)
	await page.getByRole('button', { name: '已对齐，继续' }).click()
	await setCardLength(page, 34)
	await page.getByRole('button', { name: '已对齐，继续' }).click()
	await expect(page.getByRole('dialog').getByRole('alert')).toContainText('超过 2%')
	await setCardLength(page, 33.5)
	await page.getByRole('button', { name: '已对齐，继续' }).click()
	await expect(page.getByText('第 3 / 3 步 · 独立复核')).toBeVisible()
	await setCardLength(page, 34.25)
	await page.getByRole('button', { name: '已对齐，继续' }).click()
	await expect(page.getByRole('dialog').getByRole('alert')).toContainText('复核与前两次校准不一致')
	await setCardLength(page, 33.75)
	await page.getByRole('button', { name: '已对齐，继续' }).click()
	await expect(page.getByRole('button', { name: '保存校准，开始测量' })).toBeVisible()
})

for (const [device, width, height, mobile] of [
	['desktop', 1440, 900, false],
	['phone', 390, 844, true]
] as const) {
	for (const [id, name, lengths] of [
		['memory-sd', /^SD 存储卡/, [32, 32, 24]],
		['memory-microsd', /^microSD \/ TF 存储卡/, [15, 15, 11]]
	] as const) {
		test(`${device}: storage card ${id} calibrates and persists`, async ({ browser }) => {
			const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile })
			const page = await context.newPage()
			await page.goto('/toolbox/ruler')
			await page.getByRole('button', { name: '开始校准', exact: true }).click()
			await page.getByRole('button', { name: '存储卡', exact: true }).click()
			await page.getByRole('button', { name }).click()
			if (id === 'memory-microsd') await expect(page.getByText(/使用 microSD（TF）卡片本体/)).toContainText('可能不够准确')
			await expect(page.getByRole('link', { name: '官方尺寸来源', exact: true })).toHaveAttribute('href', /sdcard.org/)
			for (const mm of lengths) {
				await expect(page.getByText(`${mm} mm`, { exact: true })).toBeVisible()
				await setCardLength(page, mm * 2)
				await page.getByRole('button', { name: '已对齐，继续' }).click()
			}
			await page.getByRole('button', { name: '保存校准，开始测量' }).click()
			await expect(page.getByTestId('measurement')).toHaveText('5.00')
			await page.reload()
			await expect(page.getByTestId('measurement')).toHaveText('4.00')
			const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('winrisef:screen-ruler:v2')!))
			expect(saved).toMatchObject({ method: 'card', referenceId: id })
			expect(Math.abs(saved.pxPerMm - 2) * lengths[0]).toBeLessThan(1 / 32)
			await context.close()
		})
	}
}

for (const [device, width, height] of [
	['desktop', 1440, 900],
	['phone', 390, 844],
	['small', 320, 568],
	['landscape', 844, 390]
] as const) {
	test(`${device}: single-option entries open directly and empty search offers custom calibration`, async ({ browser }) => {
		const context = await browser.newContext({ viewport: { width, height }, isMobile: device !== 'desktop', hasTouch: device !== 'desktop' })
		const page = await context.newPage()
		await page.goto('/toolbox/ruler')
		await expect(page.getByText('选择手边的实物校准，也可填写已知长度。')).toBeVisible()
		await page.getByRole('button', { name: '开始校准', exact: true }).click()
		for (const [entry, title] of [
			['银行卡', '银行卡校准'],
			['实体尺', '实体尺校准'],
			['自定义参照物', '自定义长度校准']
		]) {
			const button = page.getByRole('button', { name: entry, exact: true })
			await expect(button).not.toHaveAttribute('aria-expanded')
			await button.click()
			await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
			await page.getByRole('button', { name: '返回选择参照物' }).click()
		}
		await page.getByLabel('搜索校准参照物').fill('zzzzqqqqxxxx')
		await page.getByRole('button', { name: '使用自定义长度', exact: true }).click()
		await expect(page.getByLabel('实际长度')).toBeVisible()
		await page.getByRole('button', { name: '返回选择参照物' }).click()
		await expect(page.getByLabel('搜索校准参照物')).toHaveValue('zzzzqqqqxxxx')
		await expect(page.getByRole('button', { name: '使用自定义长度', exact: true })).toBeVisible()
		await context.close()
	})
}

for (const [device, width, height, smallerWidth, smallerHeight, screenWidth, screenHeight] of [
	['desktop', 1440, 900, 1000, 900, 1920, 1080],
	['phone', 390, 844, 390, 600, 390, 844]
] as const) {
	for (const recovery of ['restore', 'restart'] as const) {
		test(`${device}: custom alignment blocks clipped saves and recovers by ${recovery}`, async ({ browser }) => {
			const mobile = device === 'phone'
			const context = await browser.newContext({
				viewport: { width, height },
				screen: { width: screenWidth, height: screenHeight },
				isMobile: mobile,
				hasTouch: mobile
			})
			const page = await context.newPage()
			const client = await context.newCDPSession(page)
			const metrics = { width, height, screenWidth, screenHeight, deviceScaleFactor: 1, mobile }
			await client.send('Emulation.setDeviceMetricsOverride', metrics)
			await page.goto('/toolbox/ruler')
			await page.getByRole('button', { name: '开始校准', exact: true }).click()
			await page.getByRole('button', { name: '自定义参照物', exact: true }).click()
			const pixels = Math.max(width, height) * 0.9
			await setCardLength(page, pixels)
			const input = page.getByLabel('实际长度')
			await input.fill(String(pixels / 4))
			const save = page.getByRole('button', { name: '保存校准，开始测量' })
			await expect(save).toBeEnabled()
			const stamp = await page.evaluate(() => [screen.width, screen.height, devicePixelRatio])
			// Resize the viewport while keeping the physical display and scale unchanged.
			await client.send('Emulation.setDeviceMetricsOverride', { ...metrics, width: smallerWidth, height: smallerHeight })
			await expect(page.getByRole('dialog').getByRole('alert')).toContainText('当前空间不足，已保留对齐长度')
			await expect(save).toBeDisabled()
			expect(await page.evaluate(() => [screen.width, screen.height, devicePixelRatio])).toEqual(stamp)
			await input.press('Enter')
			await expect(page.getByRole('dialog')).toBeVisible()
			expect(await page.evaluate(() => localStorage.getItem('winrisef:screen-ruler:v2'))).toBeNull()
			if (recovery === 'restore') {
				await client.send('Emulation.setDeviceMetricsOverride', metrics)
				await expect
					.poll(async () => {
						const box = (await page.getByTestId('calibration-line').boundingBox())!
						return Math.abs(Math.max(box.width, box.height) - pixels)
					})
					.toBeLessThan(1 / 32)
				await expect(input).toHaveValue(String(pixels / 4))
			} else {
				await page.getByRole('button', { name: '重新开始校准' }).click()
				await expect(input).toHaveValue('')
				await expect(save).toBeDisabled()
				const newPixels = Math.max(smallerWidth, smallerHeight) * 0.75
				await setCardLength(page, newPixels)
				await input.fill(String(newPixels / 4))
			}
			await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0)
			await expect(save).toBeEnabled()
			await save.click()
			const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('winrisef:screen-ruler:v2')!))
			expect(saved.pxPerMm).toBeCloseTo(4, 3)
			await context.close()
		})
	}
}
