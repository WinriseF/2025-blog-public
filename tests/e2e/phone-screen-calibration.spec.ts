import { expect, test, devices } from '@playwright/test'

for (const [name, width, height] of [
	['portrait', 390, 844],
	['landscape', 844, 390]
] as const) {
	test(`phone model ${name}: apply without alignment, restore and invalidate on zoom or screen changes`, async ({ browser }) => {
		const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width, height }, screen: { width, height } })
		const page = await context.newPage()
		await page.goto('/toolbox/ruler')
		await page.getByRole('button', { name: '选择当前手机型号', exact: true }).click()
		await page.getByLabel('搜索当前手机型号').fill('IPHNE 14')
		await page.getByRole('button', { name: /^iPhone 14 国际版/ }).click()
		await expect(page.getByTestId('calibration-line')).toHaveCount(0)
		const apply = page.getByRole('button', { name: '应用型号，开始测量' })
		await expect(apply).toBeEnabled()
		await expect(apply).toBeInViewport()
		expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
		await apply.click()
		await expect(page.getByRole('button', { name: '型号估算', exact: true })).toBeVisible()
		const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('winrisef:screen-ruler:v2')!))
		expect(saved).toMatchObject({ method: 'device', referenceId: 'apple-iphone-14', screenKind: 'main', checkErrorMm: null })
		expect(saved.pxPerMm).toBeCloseTo(Math.hypot(390, 844) / (6.06 * 25.4), 6)
		await page.reload()
		await expect(page.getByTestId('measurement')).toHaveText('4.00')
		const client = await context.newCDPSession(page)
		await client.send('Emulation.setDeviceMetricsOverride', {
			width: height,
			height: width,
			screenWidth: height,
			screenHeight: width,
			deviceScaleFactor: 3,
			mobile: true
		})
		await expect(page.getByTestId('measurement')).toHaveText('4.00')
		expect(await page.evaluate(() => JSON.parse(localStorage.getItem('winrisef:screen-ruler:v2')!).pxPerMm)).toBe(saved.pxPerMm)
		await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.5 })
		await expect(page.getByTestId('measurement')).toHaveText('—')
		await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
		await expect(page.getByTestId('measurement')).toHaveText('4.00')
		await page.evaluate(() => {
			Object.defineProperty(window, 'devicePixelRatio', { value: 2 })
			window.dispatchEvent(new Event('resize'))
		})
		await expect(page.getByTestId('measurement')).toHaveText('—')
		await context.close()
	})
}

test('phone model: foldable requires a screen choice and rejects the wrong screen', async ({ browser }) => {
	const context = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 452, height: 1000 }, screen: { width: 452, height: 1158 } })
	const page = await context.newPage()
	await page.goto('/toolbox/ruler')
	await page.getByRole('button', { name: '选择当前手机型号', exact: true }).click()
	await page.getByLabel('搜索当前手机型号').fill('Galaxy Z Fold5')
	await page.getByRole('button', { name: /^Galaxy Z Fold5 / }).click()
	const apply = page.getByRole('button', { name: '应用型号，开始测量' })
	await expect(apply).toBeDisabled()
	await page.getByRole('button', { name: /^内屏/ }).click()
	await expect(page.getByRole('dialog').getByRole('alert')).toContainText('屏幕比例')
	await expect(apply).toBeDisabled()
	await page.getByRole('button', { name: /^外屏/ }).click()
	await expect(apply).toBeEnabled()
	await apply.click()
	await expect(page.getByRole('button', { name: '型号估算', exact: true })).toBeVisible()
	const client = await context.newCDPSession(page)
	await client.send('Emulation.setDeviceMetricsOverride', {
		width: 906,
		height: 1088,
		screenWidth: 906,
		screenHeight: 1088,
		deviceScaleFactor: 2,
		mobile: true
	})
	await expect(page.getByTestId('measurement')).toHaveText('—')
	await context.close()
})

test('phone model: desktop redirects to physical calibration instead of using phone scale', async ({ page }) => {
	await page.goto('/toolbox/ruler')
	await page.getByRole('button', { name: '开始校准', exact: true }).click()
	await page.getByRole('button', { name: '使用当前手机型号', exact: true }).click()
	await page.getByLabel('搜索当前手机型号').fill('iphone14')
	await page.getByRole('button', { name: /^iPhone 14 国际版/ }).click()
	await expect(page.getByRole('dialog').getByRole('alert')).toContainText('电脑请使用实物校准')
	await expect(page.getByRole('button', { name: '应用型号，开始测量' })).toBeDisabled()
	await page.getByRole('button', { name: '改用实物校准' }).click()
	await page.getByRole('button', { name: '银行卡', exact: true }).click()
	await expect(page.getByRole('button', { name: '拖动调整参照线' })).toBeVisible()
})
