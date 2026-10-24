export type PenStroke = {
	start: [number, number, number]
	curves: [number, number, number, number, number, number, number][]
}

type Digit = {
	originX: number
	advance: number
	duration: number
	strokes: PenStroke[]
}

// Coordinates retain the approved C artwork's baseline at y = 600.
// The two forms of 2 give the opening and internal strokes different flourishes.
const openingTwo: Digit = {
	originX: 55, advance: 210, duration: 1150,
	strokes: [{ start: [137, 726, 0.6], curves: [
		[111, 726, 116, 699, 155, 670, 19],
		[179, 651, 211, 635, 229, 639, 12],
		[252, 642, 247, 666, 229, 696, 26],
		[204, 734, 133, 814, 78, 867, 14],
		[52, 891, 54, 862, 82, 839, 5],
		[105, 820, 123, 816, 157, 809, 19],
		[205, 801, 266, 778, 296, 739, 1.2]
	] }]
}

const digits: Record<string, Digit> = {
	'0': { originX: 265, advance: 80, duration: 900, strokes: [{ start: [366, 692, 1], curves: [
		[347, 683, 308, 725, 289, 776, 24],
		[274, 814, 280, 838, 301, 844, 14],
		[328, 852, 366, 792, 378, 746, 8],
		[389, 708, 377, 697, 366, 692, 1]
	] }] },
	'1': { originX: 0, advance: 110, duration: 800, strokes: [{ start: [24, 710, 0.6], curves: [
		[52, 696, 84, 665, 100, 646, 4],
		[89, 695, 57, 797, 42, 837, 22],
		[37, 853, 95, 844, 131, 826, 0.6]
	] }] },
	'2': { originX: 345, advance: 195, duration: 1100, strokes: [{ start: [421, 705, 0.7], curves: [
		[405, 695, 436, 668, 469, 651, 10],
		[487, 640, 503, 641, 508, 655, 9],
		[522, 685, 476, 735, 432, 783, 27],
		[407, 811, 383, 838, 365, 852, 10],
		[343, 871, 346, 851, 371, 834, 5],
		[401, 813, 435, 811, 465, 812, 12],
		[503, 813, 528, 797, 550, 770, 1.2]
	] }] },
	'3': { originX: 0, advance: 140, duration: 1050, strokes: [{ start: [25, 697, 0.6], curves: [
		[48, 665, 121, 634, 135, 661, 12],
		[149, 690, 100, 738, 65, 749, 20],
		[48, 754, 81, 733, 106, 745, 3],
		[156, 769, 100, 849, 58, 854, 22],
		[27, 857, 12, 843, 23, 823, 0.5]
	] }] },
	'4': { originX: 0, advance: 145, duration: 1000, strokes: [
		{ start: [114, 645, 0.6], curves: [[83, 688, 37, 756, 22, 781, 17], [51, 784, 121, 776, 159, 763, 1]] },
		{ start: [153, 650, 0.6], curves: [[133, 714, 101, 811, 89, 850, 24], [86, 861, 106, 852, 120, 844, 0.6]] }
	] },
	'5': { originX: 0, advance: 140, duration: 1000, strokes: [
		{ start: [155, 646, 0.5], curves: [[122, 654, 85, 654, 64, 652, 13], [55, 681, 41, 722, 34, 750, 18], [57, 734, 92, 728, 117, 749, 9], [159, 793, 89, 866, 47, 852, 23], [28, 847, 18, 834, 27, 821, 0.5]] }
	] },
	'6': { originX: 540, advance: 160, duration: 1200, strokes: [{ start: [689, 606, 0.2], curves: [
		[639, 622, 582, 695, 560, 770, 32],
		[542, 821, 555, 858, 584, 862, 18],
		[621, 874, 673, 818, 683, 777, 17],
		[695, 738, 677, 714, 655, 720, 9],
		[628, 729, 589, 769, 579, 790, 0.2]
	] }] },
	'7': { originX: 0, advance: 140, duration: 900, strokes: [{ start: [17, 690, 0.6], curves: [
		[45, 660, 124, 673, 156, 650, 14],
		[135, 698, 82, 797, 60, 852, 25],
		[57, 860, 59, 863, 63, 862, 0.5]
	] }] },
	'8': { originX: 0, advance: 140, duration: 1200, strokes: [{ start: [105, 651, 1], curves: [
		[67, 632, 25, 694, 66, 730, 21],
		[97, 758, 139, 785, 113, 831, 16],
		[86, 872, 33, 859, 32, 825, 10],
		[31, 792, 102, 739, 131, 695, 19],
		[152, 661, 129, 641, 105, 651, 1]
	] }] },
	'9': { originX: 0, advance: 140, duration: 1100, strokes: [{ start: [136, 668, 1], curves: [
		[113, 635, 52, 656, 38, 717, 24],
		[19, 778, 78, 788, 112, 727, 7],
		[139, 682, 150, 654, 139, 700, 12],
		[124, 756, 95, 832, 60, 857, 25],
		[43, 869, 28, 866, 26, 858, 0.5]
	] }] },
	'-': { originX: 0, advance: 95, duration: 300, strokes: [{ start: [14, 756, 0.5], curves: [[35, 753, 64, 749, 82, 745, 6]] }] }
}

export function getYearDigits(year: number) {
	return String(year).split('').map((digit, index) => digit === '2' && index === 0 ? openingTwo : digits[digit])
}
