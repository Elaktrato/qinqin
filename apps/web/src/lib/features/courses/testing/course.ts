// A small filled course for the courses feature's tests (#222): a start unit without words, two units of words in
// level 1 and one in level 2, shaped like GET /api/courses/{id} after decodeCourse.
import type { Course, CourseUnit, CourseWord } from '$lib/api/courses';

export function word(key: string, entryId: number, reading = '', topics: string[] = []): CourseWord {
	return { key, form: key, reading, entryId, rank: null, topics };
}

function unit(id: string, over: Partial<CourseUnit> = {}): CourseUnit {
	return { id, title: { en: id }, topics: [], grammar: [], characters: [], scripts: [], text: null, focus: null, test: true, words: [], lessons: [], ...over };
}

export function testCourse(): Course {
	return {
		id: 'zh-test',
		name: 'Test course',
		version: '1',
		license: 'CC-BY-4.0',
		attribution: 'tests',
		notice: '',
		fill: 'f1',
		language: 'zh',
		title: { en: 'Test course' },
		source: { kind: 'levels', pack: 'lv' },
		checkpoints: { lesson: { questions: 5 }, unit: { questions: 10, passPercent: 80 }, section: { questions: 20, passPercent: 75 } },
		sections: [
			{
				id: 'start',
				level: null,
				levelName: null,
				title: { en: 'Start' },
				exam: false,
				units: [unit('sounds', { focus: 'listening', test: false, lessons: [{ id: 'listening', kind: 'listening' }] })]
			},
			{
				id: 'level-1',
				level: 1,
				levelName: '1',
				title: { en: 'Level 1' },
				exam: true,
				units: [
					unit('hello', {
						characters: ['好'],
						grammar: ['g:shi'],
						text: { title: '你好', body: '你好！谢谢！', translation: { en: 'Hello! Thank you!' } },
						words: [word('你好', 101, 'nǐ hǎo'), word('谢谢', 102, 'xiè xie')],
						lessons: [
							{ id: 'script', kind: 'script', characters: ['好'], scripts: [] },
							{ id: 'words-1', kind: 'words', words: ['你好', '谢谢'] },
							{ id: 'grammar-shi', kind: 'grammar', point: 'g:shi', available: true },
							{ id: 'practice', kind: 'practice' },
							{ id: 'reading', kind: 'reading' }
						]
					}),
					unit('study', {
						words: [word('学习', 103, 'xué xí')],
						lessons: [
							{ id: 'words-1', kind: 'words', words: ['学习'] },
							{ id: 'practice', kind: 'practice' }
						]
					})
				]
			},
			{
				id: 'level-2',
				level: 2,
				levelName: '2',
				title: { en: 'Level 2' },
				exam: true,
				units: [
					unit('money', {
						words: [word('银行', 104, 'yín háng'), word('中国', 105, 'Zhōng guó')],
						lessons: [
							{ id: 'words-1', kind: 'words', words: ['银行', '中国'] },
							{ id: 'practice', kind: 'practice' }
						]
					})
				]
			}
		],
		unplaced: [],
		counts: { candidates: 5, placed: 5, byTopic: 0, unplaced: 0 }
	};
}
