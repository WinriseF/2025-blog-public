export type Sticker = {
	id: string
	label: string
	emoji: string
}

export const STICKERS: Sticker[] = [
	{ id: 'smile', label: '微笑', emoji: '🙂' },
	{ id: 'cool', label: '墨镜', emoji: '😎' },
	{ id: 'wink', label: '眨眼', emoji: '😉' },
	{ id: 'grin', label: '开心', emoji: '😄' },
	{ id: 'laugh', label: '大笑', emoji: '😂' },
	{ id: 'blush', label: '害羞', emoji: '😊' },
	{ id: 'star-eyes', label: '星星眼', emoji: '🤩' },
	{ id: 'thinking', label: '思考', emoji: '🤔' },
	{ id: 'shush', label: '保密', emoji: '🤫' },
	{ id: 'party', label: '派对', emoji: '🥳' },
	{ id: 'alien', label: '外星人', emoji: '👽' },
	{ id: 'ghost', label: '幽灵', emoji: '👻' },
	{ id: 'robot', label: '机器人', emoji: '🤖' },
	{ id: 'bear', label: '小熊', emoji: '🐻' },
	{ id: 'rabbit', label: '兔子', emoji: '🐰' },
	{ id: 'cat', label: '小猫', emoji: '🐱' },
	{ id: 'dog', label: '小狗', emoji: '🐶' },
	{ id: 'fox', label: '狐狸', emoji: '🦊' },
	{ id: 'monkey', label: '猴子', emoji: '🐵' },
	{ id: 'pig', label: '小猪', emoji: '🐷' },
	{ id: 'tiger', label: '老虎', emoji: '🐯' },
	{ id: 'lion', label: '狮子', emoji: '🦁' },
	{ id: 'frog', label: '青蛙', emoji: '🐸' },
	{ id: 'panda', label: '熊猫', emoji: '🐼' },
	{ id: 'koala', label: '考拉', emoji: '🐨' },
	{ id: 'unicorn', label: '独角兽', emoji: '🦄' },
	{ id: 'heart', label: '爱心', emoji: '❤️' },
	{ id: 'star', label: '星星', emoji: '⭐' },
	{ id: 'flower', label: '花朵', emoji: '🌸' }
]

export const DEFAULT_STICKER = STICKERS[0]
