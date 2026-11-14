import type { PhoneScreen } from './ruler-references'
import { calibrationScale, screenStamp, type ScreenStamp } from './screen-ruler'

export const phoneScreenLabels: Record<PhoneScreen['kind'], string> = {
	main: '主屏',
	inner: '内屏',
	cover: '外屏',
	rear: '背屏',
	folded: '折叠状态',
	unfolded: '展开状态',
	triple: '三屏展开'
}

export type PhoneScreenEnvironment = ScreenStamp & { mobile: boolean; viewportWidth: number; screenWidth: number; pinchScale: number }

export function phoneScreenEnvironment(): PhoneScreenEnvironment {
	const ua = navigator as Navigator & { userAgentData?: { mobile: boolean } }
	return {
		...screenStamp(),
		mobile: Boolean(ua.userAgentData?.mobile || /iPhone|Android/i.test(ua.userAgent)),
		viewportWidth: window.innerWidth,
		screenWidth: window.screen.width,
		pinchScale: window.visualViewport?.scale || 1
	}
}

export function phoneScreenDimensions(screen: PhoneScreen) {
	const width = screen.resolutionWidthPx,
		height = screen.resolutionHeightPx
	if (screen.kind === 'rear' || screen.resolutionBasis === 'super-pixel' || !width || !height) return null
	// Prefer a published millimetre diagonal; inch marketing values may be rounded.
	const diagonalMm = screen.diagonalMm ?? (screen.diagonalInches ? screen.diagonalInches * 25.4 : null)
	// A diagonal is required: PPI-only circular screens do not describe a rectangular display.
	if (!diagonalMm || !Number.isFinite(diagonalMm) || diagonalMm <= 0) return null
	const factor = diagonalMm / Math.hypot(width, height)
	return { widthMm: width * factor, heightMm: height * factor, diagonalMm }
}

export function estimatePhoneScreen(screen: PhoneScreen, environment: PhoneScreenEnvironment) {
	const dimensions = phoneScreenDimensions(screen)
	if (!dimensions) return { error: '这块屏幕的尺寸资料暂不支持估算，请改用实物校准。' } as const
	if (!environment.mobile) return { error: '请在这台手机的浏览器中打开，并使用移动版页面；电脑请使用实物校准。' } as const
	if (Math.abs(environment.pinchScale - 1) >= 0.01) return { error: '请恢复页面缩放后再应用型号。' } as const
	if (Math.abs(environment.viewportWidth / environment.screenWidth - 1) > 0.02) return { error: '请退出分屏或桌面版页面，并恢复页面缩放后重试。' } as const
	// Use the CSS screen size, not native resolution / DPR: Android can render below panel resolution.
	const ratioError = Math.abs(environment.width / environment.height / (dimensions.widthMm / dimensions.heightMm) - 1)
	if (!Number.isFinite(ratioError) || ratioError > 0.02) return { error: '当前屏幕比例与所选规格不符，请检查手机型号及内外屏选择，或改用实物校准。' } as const
	const pxPerMm = calibrationScale(Math.hypot(environment.width, environment.height), dimensions.diagonalMm)
	return pxPerMm ? ({ pxPerMm, dimensions } as const) : ({ error: '无法读取当前屏幕比例，请使用实物校准。' } as const)
}
