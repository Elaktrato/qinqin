// Tests of the level pack converter's parsing rules:
//   node --test scripts/prepare-level-packs.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PackError, records, stripSuru, vocabForms } from './prepare-level-packs.mjs';

test('stripSuru keeps する after a one-character stem', () => {
	for (const verb of ['関する', '対する', '値する', '摩する', '愛する']) {
		assert.equal(stripSuru(verb), verb);
	}
	assert.equal(stripSuru('勉強する'), '勉強');
	assert.equal(stripSuru('コピーする'), 'コピー');
	assert.equal(stripSuru('する'), 'する');
});

test('vocabForms pairs readings with the pieces', () => {
	assert.deepEqual(vocabForms('風', 'かぜ').forms, [{ form: '風', reading: 'かぜ' }]);
	assert.deepEqual(vocabForms('足; 脚', 'あし').forms, [
		{ form: '足', reading: 'あし' },
		{ form: '脚', reading: 'あし' }
	]);
	assert.deepEqual(vocabForms('いい; よい', 'いい; よい').forms, [
		{ form: 'いい', reading: '' },
		{ form: 'よい', reading: '' }
	]);
	assert.deepEqual(vocabForms('伯父; 叔父さん', 'おじ').forms, [
		{ form: '伯父', reading: 'おじ' },
		{ form: '叔父さん', reading: 'おじ' }
	]);
	assert.deepEqual(vocabForms('～円', '～えん').forms, [{ form: '円', reading: 'えん' }]);
	assert.deepEqual(vocabForms('勉強する', 'べんきょうする').forms, [{ form: '勉強', reading: 'べんきょう' }]);
	assert.deepEqual(vocabForms('関する', 'かんする').forms, [{ form: '関する', reading: 'かんする' }]);
	assert.deepEqual(vocabForms('風', 'kaze').forms, [{ form: '風', reading: '' }]);
	const pattern = vocabForms('いくら～ても', 'いくら～ても');
	assert.deepEqual(pattern.forms, []);
	assert.equal(pattern.dropped, 1);
});

test('records fails with the file name on an empty or malformed CSV', () => {
	assert.throws(() => records('', 'n5.csv', ['expression']), (err) => err instanceof PackError && /n5\.csv: empty/.test(err.message));
	assert.throws(() => records('a,b\n"x,1\n', 'n4.csv', ['a']), (err) => err instanceof PackError && /n4\.csv: unterminated/.test(err.message));
	assert.throws(() => records('a,b\n1,2\n', 'n3.csv', ['expression']), (err) => err instanceof PackError && /missing column expression/.test(err.message));
	assert.deepEqual(records('﻿expression,reading\n風,かぜ\n', 'n2.csv', ['expression']), [{ expression: '風', reading: 'かぜ' }]);
});
