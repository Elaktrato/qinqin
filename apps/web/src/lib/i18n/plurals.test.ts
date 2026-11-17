import { describe, expect, it } from 'vitest';
import { t, type MessageArgs, type MessageKey } from './index';

// The catalogue plurals that replaced hand-rolled `n === 1 ? … : …` English (extraction Tasks 9+): each keeps
// the exact English of both branches. One row per plural message: [key, extra args, one, other] with count 1
// and 2 (other args as given).
const CASES: [MessageKey, MessageArgs, string, string][] = [
	// shell (Task 9)
	[
		'pwa.app.offlineReady',
		{ time: '09:05' },
		'Offline: ready - 1 card saved at 09:05',
		'Offline: ready - 2 cards saved at 09:05'
	],
	[
		'pwa.offline.queued',
		{},
		"You're offline. 1 review is saved on this device and will be sent when you're back online.",
		"You're offline. 2 reviews are saved on this device and will be sent when you're back online."
	],
	// auth and account (Task 10)
	[
		'account.logout.unsent',
		{},
		'1 review has not been sent yet. If you sign out now it is deleted from this device.',
		'2 reviews have not been sent yet. If you sign out now they are deleted from this device.'
	],
	[
		'account.mfa.fewRecoveryLeft',
		{},
		'Only 1 recovery code is left. Consider making new ones.',
		'Only 2 recovery codes are left. Consider making new ones.'
	],
	['account.otp.attemptsLeft', {}, '1 attempt left', '2 attempts left'],
	['account.otp.resendIn', {}, 'You can ask for a new code in 1 second.', 'You can ask for a new code in 2 seconds.'],
	[
		'account.data.reidentified',
		{},
		'1 study event got new ids because another account here uses it.',
		'2 study events got new ids because another account here uses them.'
	],
	['account.data.missingSentences', {}, '1 example sentence cannot be matched either.', '2 example sentences cannot be matched either.'],
	[
		'account.data.droppedReviews',
		{},
		'1 review waiting on this device for the old workspaces was discarded.',
		'2 reviews waiting on this device for the old workspaces were discarded.'
	],
	['account.backup.countWorkspaces', {}, '1 workspace', '2 workspaces'],
	['account.backup.countEvents', {}, '1 study event', '2 study events'],
	['account.backup.countCards', {}, '1 card', '2 cards'],
	['account.backup.countBooks', {}, '1 book', '2 books'],
	['account.backup.countEdits', {}, '1 word edit', '2 word edits'],
	['account.backup.countSentences', {}, '1 own sentence', '2 own sentences'],
	['account.backup.entryCards', {}, '1 card', '2 cards'],
	['account.backup.entryEdits', {}, '1 edit', '2 edits'],
	['account.backup.entryNotes', {}, '1 note', '2 notes']
];

describe('catalogue plurals keep their English', () => {
	it.each(CASES)('%s', (key, args, one, other) => {
		expect(t(key, { ...args, count: 1 })).toBe(one);
		expect(t(key, { ...args, count: 2 })).toBe(other);
	});
});
