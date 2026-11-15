#!/usr/bin/env node
// LOCAL-ONLY tool: builds an audio pack from Wikimedia Commons pronunciation
// files (Zh-<pinyin>.ogg syllables and Lingua Libre word recordings) for
// `qinqin seed`. Run by a person, never in CI or the image.
//
//   node scripts/fetch-audio-commons.mjs --lang zh|ja --category <Commons category> [--limit N] [<out>]
//
// <out> defaults to plugins/data-local/commons-audio-<lang> and must lie
// under a data-local directory: the licence of a recording is per file and
// the set keeps changing, so the pack is never committed or bundled. A file is
// kept only when its Commons LicenseShortName is on the allow-list (CC0,
// public domain, CC BY 2.0-4.0 and CC BY-SA 2.0-4.0 including national
// ports); everything else is skipped and counted. Each kept clip gets its
// licence, its Artist (HTML stripped) and its file-page URL in index.tsv.
//
// Politeness: at most one request per second, with a User-Agent naming this
// tool. Needs Node 24 or newer (global fetch).
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'qinqin-audio-fetch (local tool)';
const MAX_CLIP_BYTES = 2 << 20;

// Every toneless Mandarin syllable the server's pinyin package accepts
// (nu: written v), so an index row can never fail the import.
const SYLLABLES = new Set(
	(
	'a ai an ang ao ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bou bu ca cai can cang '+
	'cao ce cen ceng cha chai chan chang chao che chei chen cheng chi chong chou chu chua chuai chuan '+
	'chuang chui chun chuo ci cong cou cu cuan cui cun cuo da dai dan dang dao de dei den deng di dia '+
	'dian diao die ding diu dong dou du duan dui dun duo e ei en eng er fa fan fang fei fen feng fo fou '+
	'fu ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo ha hai han hang '+
	'hao he hei hen heng hong hou hu hua huai huan huang hui hun huo i ia ian iang iao ie in ing iong ji '+
	'jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun ka kai kan kang kao ke kei ken keng kong '+
	'kou ku kua kuai kuan kuang kui kun kuo la lai lan lang lao le lei len leng li lia lian liang liao '+
	'lie lin ling liu lo long lou lu luan lun luo lv lve ma mai man mang mao me mei men meng mi mian miao '+
	'mie min ming miu mo mou mu na nai nan nang nao ne nei nen neng ni nian niang niao nie nin ning niu '+
	'nong nou nu nuan nun nuo nv nve o ou pa pai pan pang pao pei pen peng pi pian piao pie pin ping po '+
	'pou pu qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun ran rang rao re ren reng ri '+
	'rong rou ru ruan rui run ruo sa sai san sang sao se sen seng sha shai shan shang shao she shei shen '+
	'sheng shi shou shu shua shuai shuan shuang shui shun shuo si song sou su suan sui sun suo ta tai tan '+
	'tang tao te tei teng ti tian tiao tie ting tong tou tu tuan tui tun tuo u ua uai uan uang uo v van '+
	've vn wa wai wan wang wei wen weng wo wu xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue '+
	'xun ya yan yang yao ye yi yia yian yiang yiao yie yin ying yiong yong you yu yuan yue yun za zai zan '+
	'zang zao ze zei zen zeng zha zhai zhan zhang zhao zhe zhei zhen zheng zhi zhong zhou zhu zhua zhuai '+
	'zhuan zhuang zhui zhun zhuo zi zong zou zu zuan zui zun zuo'
	).split(' ')
);

const TONE_MARKS = {};
for (const [base, forms] of Object.entries({ a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', v: 'ǖǘǚǜ' })) {
	[...forms].forEach((c, i) => (TONE_MARKS[c] = [base, i + 1]));
}

/** allowedLicence reports whether a Commons LicenseShortName may be kept. */
export function allowedLicence(shortName) {
	if (typeof shortName !== 'string') return false;
	return /^(cc0( 1\.0)?|public domain|cc by(-sa)? (2\.0|2\.5|3\.0|4\.0)( [a-z]{2,3})?)$/i.test(shortName.trim());
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** stripHtml turns the HTML of an extmetadata value into one line of text. */
export function stripHtml(html) {
	return String(html ?? '')
		.replace(/<[^>]*>/g, ' ')
		.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
			if (e[0] === '#') {
				const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
				return Number.isFinite(code) ? String.fromCodePoint(code) : m;
			}
			return ENTITIES[e.toLowerCase()] ?? m;
		})
		.replace(/\s+/g, ' ')
		.trim();
}

/** syllableKey turns the pinyin of a Zh- file title into "ni3", or "" when it is not one syllable. */
function syllableKey(text) {
	let tone = 0;
	let letters = '';
	for (const c of text.normalize('NFC').toLowerCase()) {
		if (TONE_MARKS[c]) {
			letters += TONE_MARKS[c][0];
			tone = TONE_MARKS[c][1];
		} else if (c === 'ü') letters += 'v';
		else letters += c;
	}
	letters = letters.replace('u:', 'v');
	const m = /^([a-z]+)([1-5])?$/.exec(letters);
	if (!m || !SYLLABLES.has(m[1])) return '';
	return `${m[1]}${tone || m[2] || '5'}`;
}

const LL_CODES = { zh: ['cmn', 'zho', 'zh'], ja: ['jpn', 'ja'] };

/** titleRow reads kind, form and reading off a file title, or null. */
function titleRow(title, lang) {
	const name = title.replace(/^File:/i, '');
	if (lang === 'zh') {
		const m = /^Zh-(.+)\.(?:ogg|oga|opus|mp3|wav|flac)$/i.exec(name);
		if (m) {
			const reading = syllableKey(m[1]);
			return reading ? { kind: 'syllable', form: '', reading } : null;
		}
	}
	const ll = /^LL-Q\d+ \(([a-z-]+)\)-([^-]+)-(.+)\.(?:wav|ogg|oga|opus|mp3|flac)$/i.exec(name);
	if (!ll || !LL_CODES[lang].includes(ll[1].toLowerCase())) return null;
	const form = ll[3].trim();
	// "102 块钱" is a recording of the whole phrase, not of 块钱; a word with
	// ASCII letters or digits is not a dictionary headword either.
	if (!form || /[A-Za-z0-9\s]/.test(form)) return null;
	return { kind: 'term', form, reading: '' };
}

/** fileSource picks the file to download: the original when it is Ogg or MP3, else a derivative. */
function fileSource(info, derivatives) {
	const url = String(info.url ?? '').split('?')[0];
	const m = /\.(ogg|oga|opus|mp3)$/i.exec(url);
	if (m) return { url, ext: m[1].toLowerCase() === 'oga' ? 'ogg' : m[1].toLowerCase() };
	for (const key of ['ogg', 'mp3']) {
		const d = derivatives.find((x) => x.transcodekey === key);
		if (d?.src) return { url: String(d.src).split('?')[0], ext: key };
	}
	return null;
}

/**
 * rowFromFile turns one API page (imageinfo, optionally videoinfo) into
 * {pageid, kind, form, reading, license, attribution, source, url, ext}, or
 * null when its licence is not allowed, its title is not a clip of lang or
 * it has no usable file. dropReason(page, lang) tells which.
 */
export function rowFromFile(page, lang) {
	return classify(page, lang).row ?? null;
}

function classify(page, lang) {
	const info = page.imageinfo?.[0];
	if (!info) return { reason: 'title' };
	const meta = info.extmetadata ?? {};
	const license = String(meta.LicenseShortName?.value ?? '').trim();
	if (!allowedLicence(license)) return { reason: 'licence' };
	const t = titleRow(page.title ?? '', lang);
	if (!t) return { reason: 'title' };
	const src = fileSource(info, page.videoinfo?.[0]?.derivatives ?? []);
	if (!src) return { reason: 'title' };
	const artist = stripHtml(meta.Artist?.value);
	return {
		row: {
			pageid: page.pageid,
			...t,
			license,
			attribution: artist || 'Unknown contributor (see the source page)',
			source: info.descriptionurl ?? '',
			url: src.url,
			ext: src.ext,
		},
		license,
	};
}

/** plan keeps the allowed pages: {rows, dropped: {licence, title}, licences: {name: count}}. */
export function plan(pages, lang) {
	const out = { rows: [], dropped: { licence: 0, title: 0 }, licences: {} };
	for (const page of pages) {
		const c = classify(page, lang);
		if (c.row) {
			out.rows.push(c.row);
			out.licences[c.license] = (out.licences[c.license] ?? 0) + 1;
		} else out.dropped[c.reason]++;
	}
	return out;
}

/** writeIndexFiles writes manifest.json, index.tsv, LICENSE and ATTRIBUTION.md; rows carry their `file`. */
export function writeIndexFiles(out, lang, rows, res, date) {
	mkdirSync(out, { recursive: true });
	const clean = (s) => String(s).replace(/[\t\r\n]+/g, ' ').trim();
	const lines = ['kind\tform\treading\tfile\tlicense\tattribution\tsource'];
	for (const r of rows) lines.push([r.kind, r.form, r.reading, r.file, r.license, r.attribution, r.source].map(clean).join('\t'));
	writeFileSync(join(out, 'index.tsv'), lines.join('\n') + '\n');
	const manifest = {
		id: `commons-audio-${lang}`,
		name: `Commons ${lang === 'zh' ? 'Mandarin' : 'Japanese'} pronunciations`,
		version: date,
		type: 'audio',
		language: lang,
		license: 'per file',
		attribution: 'Wikimedia Commons and Lingua Libre contributors, credited per recording',
		notice:
			'Recordings from [Wikimedia Commons](https://commons.wikimedia.org) and Lingua Libre. Each recording has its own licence (CC0, public domain, CC BY or CC BY-SA) and credit, listed per recording. Only files with such a licence were kept. This pack was fetched locally and is not part of qinqin.',
		format: 'audio-index',
	};
	writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
	writeFileSync(join(out, 'LICENSE'), 'Each recording carries its own licence; see the license and source columns of index.tsv.\n');
	const counts = Object.entries(res.licences)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `- ${k}: ${v}`)
		.join('\n');
	writeFileSync(
		join(out, 'ATTRIBUTION.md'),
		`# Commons audio (${lang})\n\nFetched ${date} with scripts/fetch-audio-commons.mjs from Wikimedia Commons. Credit and file page of every recording are in index.tsv.\n\nKept by licence:\n${counts}\n\nSkipped: ${res.dropped.licence} with a licence outside the allow-list, ${res.dropped.title} that are not a single pronunciation of this language.\n`
	);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;
async function polite(url) {
	const wait = lastRequest + 1000 - Date.now();
	if (wait > 0) await sleep(wait);
	lastRequest = Date.now();
	const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
	if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
	return res;
}

async function listPages(category, limit) {
	const pages = [];
	let cont = {};
	while (pages.length < limit) {
		const q = new URLSearchParams({
			action: 'query', format: 'json', generator: 'categorymembers', gcmtitle: `Category:${category.replace(/^Category:/i, '')}`,
			gcmtype: 'file', gcmlimit: '50', prop: 'imageinfo|videoinfo', iiprop: 'url|mime|size|extmetadata',
			iiextmetadatafilter: 'LicenseShortName|Artist', viprop: 'derivatives', ...cont,
		});
		const body = await (await polite(`${API}?${q}`)).json();
		pages.push(...Object.values(body.query?.pages ?? {}));
		if (!body.continue) break;
		cont = body.continue;
	}
	return pages.slice(0, limit);
}

const magicOk = (ext, b) => (ext === 'mp3' ? (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) : b.subarray(0, 4).toString() === 'OggS');

function usage(msg) {
	console.error(`fetch-audio-commons: ${msg}\nusage: node scripts/fetch-audio-commons.mjs --lang zh|ja --category <name> [--limit N] [<out>]`);
	process.exit(2);
}

async function main(argv) {
	const opt = {};
	const pos = [];
	for (let i = 0; i < argv.length; i++) {
		if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i];
		else pos.push(argv[i]);
	}
	if (!['zh', 'ja'].includes(opt.lang)) usage('--lang must be zh or ja');
	if (!opt.category) usage('--category is required');
	const limit = opt.limit ? Number.parseInt(opt.limit, 10) : 500;
	if (!(limit > 0)) usage('--limit must be a positive number');
	const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
	const out = resolve(pos[0] ?? join(repo, 'plugins', 'data-local', `commons-audio-${opt.lang}`));
	if (!out.split(sep).includes('data-local')) usage('the output directory must be under plugins/data-local (the recordings are never committed or bundled)');

	const res = plan(await listPages(opt.category, limit), opt.lang);
	console.log(`${res.rows.length} usable recordings; skipped ${res.dropped.licence} by licence, ${res.dropped.title} by title`);
	mkdirSync(dirname(out), { recursive: true });
	const stage = mkdtempSync(join(dirname(out), '.stage-'));
	try {
		mkdirSync(join(stage, 'audio'), { recursive: true });
		const kept = [];
		for (const r of res.rows) {
			const bytes = Buffer.from(await (await polite(r.url)).arrayBuffer());
			if (bytes.length > MAX_CLIP_BYTES || !magicOk(r.ext, bytes)) {
				res.dropped.title++;
				continue;
			}
			const file = `audio/p${r.pageid}.${r.ext}`;
			writeFileSync(join(stage, file), bytes);
			kept.push({ ...r, file });
		}
		const kres = plan([], opt.lang);
		for (const r of kept) kres.licences[r.license] = (kres.licences[r.license] ?? 0) + 1;
		kres.dropped = res.dropped;
		writeIndexFiles(stage, opt.lang, kept, kres, new Date().toISOString().slice(0, 10));
		rmSync(out, { recursive: true, force: true });
		renameSync(stage, out);
		console.log(`wrote ${kept.length} clips to ${out}`);
	} catch (e) {
		rmSync(stage, { recursive: true, force: true });
		throw e;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2)).catch((e) => {
		console.error(`fetch-audio-commons: ${e.message}`);
		process.exit(1);
	});
}
