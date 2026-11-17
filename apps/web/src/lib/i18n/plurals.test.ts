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
	['account.backup.entryNotes', {}, '1 note', '2 notes'],
	// search, entry and shared components (Task 12)
	['entry.cards.selectedCount', {}, '1 selected', '2 selected'],
	[
		'entry.cards.confirmText',
		{},
		'Delete 1 word from every deck, with its other cards? You can undo this right after.',
		'Delete 2 words from every deck, with their other cards? You can undo this right after.'
	],
	['entry.cards.deleteCount', {}, 'Delete 1 card', 'Delete 2 cards'],
	[
		'app.workspaces.delete.books',
		{},
		'1 book in its library, with their bookmarks and highlights',
		'2 books in its library, with their bookmarks and highlights'
	],
	['app.workspaces.delete.cards', {}, '1 flashcard', '2 flashcards'],
	['app.workspaces.delete.decks', {}, '1 deck', '2 decks'],
	[
		'app.workspaces.delete.reviews',
		{},
		'1 recorded review and the rest of its study history',
		'2 recorded reviews and the rest of its study history'
	],
	['search.resultsAnnounce', { query: '水' }, '1 result for “水”.', '2 results for “水”.'],
	['search.parts.count', {}, '1 character', '2 characters'],
	['search.parts.strokes', {}, '1 stroke', '2 strokes'],
	// study, widgets, goals, notes, lookups (Task 13)
	['study.actions.deleted', {}, 'Card deleted.', '2 cards deleted.'],
	['study.actions.moved', { deck: '汉' }, 'Moved to 汉.', 'Moved 2 cards to 汉.'],
	['study.actions.removed', {}, 'Card removed.', '2 cards removed.'],
	['stats.map.slot.strokes', {}, '1 stroke', '2 strokes'],
	[
		'study.outbox.queuedNotSaved',
		{},
		'1 queued review was not saved: its workspace was deleted.',
		'2 queued reviews were not saved: their workspace was deleted.'
	],
	['study.limits.reviews', {}, '1 review', '2 reviews'],
	['stats.map.filtered', { shown: '1', total: '9' }, '1 of 9 characters matches.', '1 of 9 characters match.'],
	[
		'study.store.partialPush',
		{},
		'1 row was not written because the server holds newer data for it. Try again.',
		'2 rows were not written because the server holds newer data for them. Try again.'
	],
	['goals.progress.newCards', { amount: 0 }, '0 of 1 new card today', '0 of 2 new cards today'],
	[
		'goals.progress.studyTime',
		{ amount: 0 },
		'0 of 1 minute of flashcard study today',
		'0 of 2 minutes of flashcard study today'
	],
	['goals.streak.days', {}, 'Goal streak: 1 day', 'Goal streak: 2 days'],
	['lookups.add.created', { deck: '汉' }, 'Added 1 new card to 汉', 'Added 2 new cards to 汉'],
	['lookups.add.joined', {}, '1 word joined the deck', '2 words joined the deck'],
	[
		'lookups.add.missing',
		{},
		'1 word is not in the dictionary any more.',
		'2 words are not in the dictionary any more.'
	],
	['lookups.count.all', {}, '1 word', '2 words'],
	['lookups.count.noCard', { shown: 1 }, '1 of 1 word with no card yet', '1 of 2 words with no card yet'],
	['lookups.removed', {}, 'Removed 1 word from the history.', 'Removed 2 words from the history.'],
	['lookups.prompt.add', { deck: '汉' }, 'Add this 1 to 汉', 'Add these 2 to 汉'],
	[
		'widgets.characters.unresolved',
		{},
		'1 card could not be resolved, so this may under-report.',
		'2 cards could not be resolved, so this may under-report.'
	],
	['widgets.words.inDecks', {}, 'word in your decks ·', 'words in your decks ·'],
	['widgets.words.waiting', {}, 'new card waiting', 'new cards waiting'],
	['study.setup.unit.characters', {}, 'character', 'characters'],
	['study.setup.unit.words', {}, 'word', 'words'],
	['study.summary.cardsIn', {}, 'card in', 'cards in'],
	['study.summary.decksDot', {}, 'deck ·', 'decks ·'],
	['study.sched.withReviews', { label: 'Imported 2026-11-01' }, 'Imported 2026-11-01 · 1 review', 'Imported 2026-11-01 · 2 reviews'],
	[
		'study.session.buried',
		{},
		'1 related card is buried until tomorrow',
		'2 related cards are buried until tomorrow'
	],
	['study.session.reviews', {}, 'review', 'reviews'],
	['study.session.reshows', {}, 're-show (practice, not counted)', 're-shows (practice, not counted)'],
	['study.session.streakDays', {}, 'day', 'days'],
	// stats and weekly (Task 14)
	['weekly.day.reviews', {}, '1 review', '2 reviews'],
	['weekly.daysActive.text', { active: 1 }, 'Active on 1 of 1 day', 'Active on 1 of 2 days'],
	['weekly.daysActive.soFar', { active: 1 }, 'Active on 1 of 1 day so far', 'Active on 1 of 2 days so far'],
	['weekly.streak.text', {}, 'Study streak: 1 day', 'Study streak: 2 days'],
	['weekly.streak.endOfWeek', {}, 'Study streak at the end of the week: 1 day', 'Study streak at the end of the week: 2 days'],
	['weekly.goal.text', { met: 1 }, 'Daily goal met on 1 of 1 day', 'Daily goal met on 1 of 2 days'],
	['weekly.goal.soFar', { met: 1 }, 'Daily goal met on 1 of 1 day so far', 'Daily goal met on 1 of 2 days so far'],
	['stats.activity.points', {}, '1 point', '2 points'],
	[
		'stats.activity.summaryWorkspace',
		{},
		'Learning activity in this workspace for the last week',
		'Learning activity in this workspace for the last 2 weeks'
	],
	[
		'stats.activity.summaryAll',
		{},
		'Learning activity in all workspaces for the last week',
		'Learning activity in all workspaces for the last 2 weeks'
	],
	['stats.activity.pointsInWindow', { weeks: 13 }, '1 point in the last 13 weeks', '2 points in the last 13 weeks'],
	[
		'stats.map.unresolved',
		{},
		'1 card could not be resolved, so this map may under-report mastery.',
		'2 cards could not be resolved, so this map may under-report mastery.'
	],
	['stats.map.sections', {}, '1 section', '2 sections'],
	// settings, part 1 (Task 15)
	['settings.zone.matches', {}, '1 time zone matches.', '2 time zones match.'],
	[
		'settings.home.parked',
		{},
		'stays in your layout while the plugin is disabled and comes back when you enable it under Plugins.',
		'stay in your layout while the plugin is disabled and come back when you enable it under Plugins.'
	],
	// settings, part 2 (Task 16)
	['settings.tokens.expiresInDays', {}, 'Expires in 1 day', 'Expires in 2 days'],
	['settings.tokens.expiresInHours', {}, 'Expires in 1 hour', 'Expires in 2 hours'],
	['settings.tokens.create.days', {}, '1 day', '2 days'],
	['packs.progress.bytes', {}, '1 byte', '2 bytes'],
	// admin (Task 17)
	['admin.delete.preview.workspaces', {}, '1 workspace', '2 workspaces'],
	['admin.delete.preview.studyEvents', {}, '1 recorded review and study event', '2 recorded reviews and study events'],
	['admin.delete.preview.cards', {}, '1 flashcard, with its decks and study settings', '2 flashcards, with their decks and study settings'],
	['admin.delete.preview.pluginData', {}, '1 other saved item (journal entries, notes, known words, settings)', '2 other saved items (journal entries, notes, known words, settings)'],
	['admin.delete.preview.books', {}, '1 book in the library, with its bookmarks and highlights', '2 books in the library, with their bookmarks and highlights'],
	['admin.delete.preview.overlays', {}, '1 edited dictionary entry', '2 edited dictionary entries'],
	['admin.delete.preview.sentences', {}, '1 sentence they added', '2 sentences they added'],
	['admin.delete.preview.journalPhotos', {}, '1 journal photo draft', '2 journal photo drafts'],
	['admin.delete.preview.aiKeys', {}, '1 stored AI key', '2 stored AI keys'],
	['admin.delete.preview.sessions', {}, '1 signed-in session', '2 signed-in sessions'],
	['admin.delete.preview.accessTokens', {}, '1 personal access token', '2 personal access tokens'],
	['admin.invites.expiry.days', {}, '1 day', '2 days'],
	[
		'admin.email.dependents',
		{},
		'1 person has email codes as their only second step and cannot sign in while email does not work. Fix the setup below, or reset their two-factor under Users.',
		'2 people have email codes as their only second step and cannot sign in while email does not work. Fix the setup below, or reset their two-factor under Users.'
	],
	['admin.users.notice.signedOut', { name: 'li' }, 'li was signed out of 1 session.', 'li was signed out of 2 sessions.'],
	// flashcards and milestones (Task 18)
	['flashcards.deck.cards', {}, '1 card', '2 cards'],
	[
		'flashcards.deck.deleteQuestion',
		{},
		'Delete 1 word from every deck, with their other cards? You can undo this right after.',
		'Delete 2 words from every deck, with their other cards? You can undo this right after.'
	],
	['flashcards.deck.deleteWords', {}, 'Delete 1 word', 'Delete 2 words'],
	['flashcards.deck.moveQuestion', { deck: 'HSK' }, 'Move 1 word to HSK?', 'Move 2 words to HSK?'],
	['flashcards.deck.moveWords', {}, 'Move 1 word', 'Move 2 words'],
	['flashcards.deck.words', {}, '1 word', '2 words'],
	[
		'flashcards.delete.allInGeneral',
		{ head: 'Delete “x”?' },
		'Delete “x”? Its 1 card stays in General.',
		'Delete “x”? Its 2 cards stay in General.'
	],
	[
		'flashcards.delete.allToGeneral',
		{ head: 'Delete “x”?' },
		'Delete “x”? Its 1 card moves to General.',
		'Delete “x”? Its 2 cards move to General.'
	],
	['flashcards.delete.movesToGeneral', {}, '1 moves to General', '2 move to General'],
	[
		'flashcards.delete.split',
		{ head: 'Delete “x”?', parts: '1 stays in A' },
		'Delete “x”? Its 1 card: 1 stays in A.',
		'Delete “x”? Its 2 cards: 1 stays in A.'
	],
	['flashcards.delete.staysIn', { deck: 'A' }, '1 stays in A', '2 stay in A'],
	[
		'flashcards.optimise.missing',
		{},
		'1 more review needed before the parameters can be optimised.',
		'2 more reviews needed before the parameters can be optimised.'
	],
	['flashcards.optimise.usable', {}, '1 review can be used for fitting.', '2 reviews can be used for fitting.'],
	['flashcards.starter.added', {}, 'Added 1 word', 'Added 2 words'],
	[
		'flashcards.starter.addedKnown',
		{ text: 'Added 3 words' },
		'Added 3 words; 1 you know was skipped',
		'Added 3 words; 2 you know were skipped'
	],
	['flashcards.starter.knownSkipped', {}, '1 known word skipped', '2 known words skipped'],
	['flashcards.system.characters', {}, '1 character', '2 characters'],
	['flashcards.system.levels', {}, '(1 level)', '(2 levels)'],
	[
		'flashcards.system.serverNewer',
		{},
		'The server keeps newer data for 1 row. Open the deck on your other device, then try again later.',
		'The server keeps newer data for 2 rows. Open the deck on your other device, then try again later.'
	],
	['flashcards.system.words', {}, '1 word', '2 words'],
	['flashcards.tone.wrong', {}, '1 tone wrong.', '2 tones wrong.'],
	['flashcards.widget.streakDays', {}, 'day streak', 'days streak'],
	['flashcards.writing.dotMistakes', { char: '字' }, '字: 1 mistake', '字: 2 mistakes'],
	['milestones.card.reachedRecent', {}, '1 milestone reached', '2 milestones reached'],
	['milestones.card.reachedTotal', { n: '7' }, 'You have reached 7 milestone', 'You have reached 7 milestones'],
	['milestones.title.charactersLearned', { n: '7' }, '7 character learned', '7 characters learned'],
	['milestones.title.daysActive', { n: '7' }, '7 day active', '7 days active'],
	['milestones.title.journalEntries', { n: '7' }, '7 journal entry', '7 journal entries'],
	['milestones.title.readingHours', { n: '7' }, '7 hour of reading', '7 hours of reading'],
	['milestones.title.reviews', { n: '7' }, '7 review', '7 reviews'],
	['milestones.title.streak', { n: '7' }, '7-day streak', '7-day streak'],
	['milestones.title.wordsMature', { n: '7' }, '7 mature word', '7 mature words'],
	['milestones.title.wordsStudied', { n: '7' }, '7 word studied', '7 words studied'],
	// reader (Task 19)
	['reader.entry.moreEntries', {}, 'Show 1 more entry', 'Show 2 more entries'],
	['reader.entry.moreSenses', {}, 'Show 1 more sense', 'Show 2 more senses'],
	['reader.library.booksIn', {}, '1 book in', '2 books in'],
	['reader.library.chapters', {}, '1 chapter', '2 chapters'],
	['reader.source.results', {}, '1 result', '2 results'],
	['reader.words.added', { deck: 'HSK' }, 'Added 1 word to HSK', 'Added 2 words to HSK'],
	['reader.words.addedJoined', {}, '1 already had a card and joined it', '2 already had cards and joined it'],
	['reader.words.chaptersFailed', {}, '1 chapter could not be counted.', '2 chapters could not be counted.'],
	[
		'reader.words.joined',
		{ deck: 'HSK' },
		'1 word already had a card and joined HSK',
		'2 words already had cards and joined HSK'
	],
	['reader.words.marked', {}, 'Marked 1 word as known', 'Marked 2 words as known'],
	['reader.words.tokens', {}, '1 word', '2 words'],
	['reader.words.typesNew', {}, '1 different new word', '2 different new words'],
	['reader.words.unmatched', {}, '1 passage is not in the dictionary', '2 passages are not in the dictionary'],
	// journal and grammar (Task 20)
	['journal.ai.waitMinutes', {}, '1 minute', '2 minutes'],
	['journal.review.ready', {}, 'Review ready: 1 correction.', 'Review ready: 2 corrections.'],
	[
		'journal.review.readyMissing',
		{ missing: '3' },
		'Review ready: 1 correction, 3 no longer in the text.',
		'Review ready: 2 corrections, 3 no longer in the text.'
	]
];

describe('catalogue plurals keep their English', () => {
	it.each(CASES)('%s', (key, args, one, other) => {
		expect(t(key, { ...args, count: 1 })).toBe(one);
		expect(t(key, { ...args, count: 2 })).toBe(other);
	});
});
