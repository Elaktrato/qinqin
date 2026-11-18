import { afterEach, describe, expect, it } from 'vitest';
import type { Component } from 'svelte';
import { englishText, renderPseudo } from '$lib/testing/pseudo';
import { resetCatalogue } from './index';
import PseudoStub from './PseudoStub.test.svelte';
import AppSection from '$lib/pwa/AppSection.svelte';
import EmailVerify from '$lib/account/EmailVerify.svelte';
import Badges from '$lib/components/Badges.svelte';
import NoteAnswer from '$lib/notes/NoteAnswer.svelte';
import StageBar from '$lib/components/map/StageBar.svelte';
import LimitField from '$lib/settings/LimitField.svelte';
import CreateTokenDialog from '$lib/settings/CreateTokenDialog.svelte';
import ResetMfaDialog from '$lib/admin/ResetMfaDialog.svelte';
import DeckStatsPanel from '$lib/features/flashcards/decks/DeckStatsPanel.svelte';
import HighlightBar from '$lib/features/reader/HighlightBar.svelte';
import OverallReview from '$lib/plugins/journal/OverallReview.svelte';
import PlayButton from '$lib/components/PlayButton.svelte';

// The pseudo-locale sample (spec Ruling): each extraction task adds one component of its area to SAMPLES; the
// test renders it in en-XA and fails on any text node that is still plain ASCII English (a missed string, or
// English glued around a translated part). Props should carry non-English data (CJK, digits) so only
// interface text is judged.

afterEach(() => resetCatalogue());

type Sample = { name: string; component: Component<any>; props: Record<string, unknown>; allow?: string[] };
const SAMPLES: Sample[] = [
	// shell (Task 9): jsdom is not a secure context, so the HTTPS note shows
	{ name: 'AppSection', component: AppSection, props: {} },
	// auth and account (Task 10)
	{ name: 'EmailVerify', component: EmailVerify, props: { address: '勤勤@例.中国', onverified: () => {} } },
	// search, entry and shared components (Task 12)
	{
		name: 'Badges',
		component: Badges,
		props: { badges: [{ schemeId: 1, schemeName: '汉语 (approximate)', levelName: '一级', derived: true }] }
	},
	// study, widgets, goals, notes, lookups (Task 13)
	{ name: 'NoteAnswer', component: NoteAnswer, props: { text: '记住这个字' } },
	// stats and weekly (Task 14)
	{
		name: 'StageBar',
		component: StageBar,
		props: { byStage: { unknown: 3, fresh: 2, learning: 1, mature: 1, learned: 4 } }
	},
	// settings, part 1 (Task 15)
	{
		name: 'LimitField',
		component: LimitField,
		props: { legend: '每日新卡', name: 'x', state: { mode: 'value', value: '20' }, workspaceLabel: null }
	},
	// settings, part 2 (Task 16)
	{
		name: 'CreateTokenDialog',
		component: CreateTokenDialog,
		props: { workspaces: [{ id: 1, name: '汉语' }], oncreated: () => {}, onclose: () => {} }
	},
	// admin (Task 17)
	{
		name: 'ResetMfaDialog',
		component: ResetMfaDialog,
		props: { id: 2, username: '李明', mfa: { totp: true, email: true }, onclose: () => {}, ongone: () => {} }
	},
	// flashcards and milestones (Task 18)
	{
		name: 'DeckStatsPanel',
		component: DeckStatsPanel,
		props: { numbers: { words: 12, cards: 14, studied: 8, mastered: 3, retention: null, reviews30: 40 } }
	},
	// reader (Task 19)
	{
		name: 'HighlightBar',
		component: HighlightBar,
		props: { actions: { ready: true, color: 'yellow', notice: '', pick: () => {}, note: () => {} } }
	},
	// journal and grammar (Task 20)
	{
		name: 'OverallReview',
		component: OverallReview,
		props: {
			review: {
				overall: { summary: '写得很好。', strengths: ['语法正确'], focus: ['多用连词'] },
				model: 'm-1',
				provider: '',
				annotations: [],
				createdAt: '2026-11-16T10:00:00Z'
			}
		},
		allow: ['m-1']
	},
	// the rest (Task 21): the play button's name comes from lib/audio
	{
		name: 'PlayButton',
		component: PlayButton,
		props: {
			clips: [{ url: '/a.mp3', packId: 'p', license: '公有领域', attribution: '某人', source: '来源' }],
			lang: 'zh',
			deviceVoice: false,
			label: '行'
		}
	}
];

describe('renderPseudo', () => {
	it('finds hard-coded English next to catalogue text', () => {
		const { container } = renderPseudo(PseudoStub, { word: '勤' });
		expect(englishText(container)).toEqual(['Hard coded words']);
		expect(container.textContent).toContain('勤');
	});

	it('ignores aria-hidden subtrees, scripts and styles, and honours an allow list', () => {
		const { container } = renderPseudo(PseudoStub, { word: '勤' });
		expect(englishText(container, ['Hard coded words'])).toEqual([]);
	});
});

describe('pseudo-locale sample', () => {
	it('starts empty; extraction tasks add one component per area', () => {
		expect(Array.isArray(SAMPLES)).toBe(true);
	});
	for (const s of SAMPLES)
		it(`${s.name} shows no plain English`, () => {
			const { container } = renderPseudo(s.component, s.props);
			expect(englishText(container, s.allow)).toEqual([]);
		});
});
