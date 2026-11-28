// "Easily confused with" on entry pages (#228): the other members of the sets of each Han character of a written
// form, in the workspace's script; kana are left to the drill.
import { describe, expect, it } from 'vitest';
import setsFixture from '../../../../../../../docs/contracts/lookalikes/sets.json';
import { confusedWith, confusionLanguage, loadConfusions } from './confused';
import { parseSetsFile } from './sets';

const zh = parseSetsFile(setsFixture.fileOf.zh)!;
const ja = parseSetsFile(setsFixture.fileOf.ja)!;

describe('confusedWith', () => {
	it('lists the other members of each character’s sets', () => {
		expect(confusedWith(zh, '未来', 'zh')).toEqual([{ char: '未', others: ['末'] }]);
		expect(confusedWith(zh, '末', 'zh')).toEqual([{ char: '末', others: ['未'] }]);
	});
	it('keeps to the workspace script and lists a character once', () => {
		expect(confusedWith(zh, '鸟鳥鸟', 'zh')).toEqual([{ char: '鸟', others: ['乌'] }]);
		expect(confusedWith(zh, '鸟鳥', 'zh-Hant')).toEqual([{ char: '鳥', others: ['烏'] }]);
	});
	it('leaves kana to the drill', () => {
		expect(confusedWith(ja, 'ソン', 'ja')).toEqual([]);
		expect(confusedWith(ja, '協力', 'ja')).toEqual([]);
		expect(confusedWith(ja, '週末', 'ja')).toEqual([{ char: '末', others: ['未'] }]);
	});
	it('gives nothing for another language', () => {
		expect(confusedWith(zh, '未来', 'ja')).toEqual([]);
	});
});

describe('confusionLanguage and loadConfusions', () => {
	it('reads the workspace script when the workspace reads the entry language', () => {
		expect(confusionLanguage('zh', 'zh-Hant')).toBe('zh-Hant');
		expect(confusionLanguage('zh', 'ja')).toBe('zh');
		expect(confusionLanguage('ja', undefined)).toBe('ja');
	});
	it('reads the bundled sets', async () => {
		expect((await loadConfusions('未来', 'zh')).map((c) => c.char)).toEqual(['未']);
		expect(await loadConfusions('hola', 'es')).toEqual([]);
	});
});
