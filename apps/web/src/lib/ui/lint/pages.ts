// The page manifest (#106): every route under src/routes, the files that make
// it up and the issue that owns its restyle. pages.test.ts fails when a route
// exists that is not listed, when a listed route is gone, or when a listed file
// is missing. #106 may change how a page looks, never what it is.
export type PageOwner =
	| '#99'
	| '#100'
	| '#101'
	| '#102'
	| '#103'
	| '#104'
	| '#105'
	| '#106'
	| 'none';

export interface PageEntry {
	/** The route path, as SvelteKit writes it (`/journal/[...rest]`); `/` for the root page. */
	route: string;
	/** The files that make up the page, relative to `apps/web/src` (the page, its layout and its main components). */
	files: string[];
	/** The visual-rework issue that restyles it. */
	owner: PageOwner;
	/** The views the page renders, for the primary-action and per-view checks. */
	views: string[];
}

export const PAGES: PageEntry[] = [
	{ route: '/', files: ['routes/+page.svelte', 'lib/widgets/ActivityHome.svelte', 'lib/widgets/WidgetCard.svelte'], owner: '#100', views: ['home', 'empty home'] },
	{ route: '/login', files: ['routes/login/+page.svelte'], owner: '#106', views: ['password', 'two-step code', 'email start', 'email code'] },
	{ route: '/register', files: ['routes/register/+page.svelte'], owner: '#106', views: ['register'] },
	{ route: '/reset', files: ['routes/reset/+page.svelte'], owner: '#106', views: ['request link', 'set password'] },
	{ route: '/account/password', files: ['routes/account/password/+page.svelte'], owner: '#106', views: ['forced password'] },
	{ route: '/account/two-factor-setup', files: ['routes/account/two-factor-setup/+page.svelte', 'lib/account/TwoFactorSetup.svelte', 'lib/account/QrCode.svelte', 'lib/account/RecoveryCodes.svelte'], owner: '#106', views: ['two-step setup'] },
	{ route: '/settings', files: ['routes/settings/+page.svelte', 'lib/settings/tabs.ts'], owner: '#106', views: ['workspaces', 'home', 'appearance', 'study', 'features', 'notifications', 'ai', 'account', 'data', 'admin'] },
	{ route: '/flashcards/[...rest]', files: ['routes/flashcards/[...rest]/+page.svelte', 'lib/features/flashcards/FlashcardsPage.svelte'], owner: '#106', views: ['decks view'] },
	{ route: '/study', files: ['routes/study/+page.svelte'], owner: 'none', views: ['redirect'] },
	{ route: '/study/advanced', files: ['routes/study/advanced/+page.svelte'], owner: '#106', views: ['advanced study setup'] },
	{ route: '/study/map', files: ['routes/study/map/+page.ts'], owner: 'none', views: ['redirect'] },
	{ route: '/study/scheduling', files: ['routes/study/scheduling/+page.svelte'], owner: '#106', views: ['scheduling'] },
	{ route: '/study/session', files: ['routes/study/session/+page.svelte'], owner: '#101', views: ['session'] },
	{ route: '/reader/[...rest]', files: ['routes/reader/[...rest]/+page.svelte', 'lib/features/reader/Library.svelte', 'lib/features/reader/BookView.svelte'], owner: '#102', views: ['library', 'book'] },
	{ route: '/journal/[...rest]', files: ['routes/journal/[...rest]/+page.svelte', 'lib/features/FeaturePage.svelte', 'lib/features/journal/JournalPage.svelte'], owner: '#106', views: ['journal', 'switched off'] },
	{ route: '/grammar/[...rest]', files: ['routes/grammar/[...rest]/+page.svelte', 'lib/features/FeaturePage.svelte', 'lib/features/grammar/GrammarPage.svelte'], owner: '#106', views: ['grammar', 'switched off'] },
	{ route: '/practice/[...rest]', files: ['routes/practice/[...rest]/+page.svelte', 'lib/features/FeaturePage.svelte', 'lib/features/practice/PracticePage.svelte', 'lib/features/practice/PracticeList.svelte', 'lib/features/practice/RoundView.svelte'], owner: 'none', views: ['list', 'no drill', 'round', 'result', 'switched off'] },
	{ route: '/scripts/[...rest]', files: ['routes/scripts/[...rest]/+page.svelte', 'lib/features/FeaturePage.svelte', 'lib/features/scripts/ScriptsPage.svelte'], owner: '#106', views: ['scripts', 'switched off'] },
	{ route: '/courses/[...rest]', files: ['routes/courses/[...rest]/+page.svelte', 'lib/features/FeaturePage.svelte', 'lib/features/courses/CoursesPage.svelte', 'lib/features/courses/Roadmap.svelte', 'lib/features/courses/LessonPlayer.svelte'], owner: 'none', views: ['roadmap', 'lesson', 'switched off'] },
	{ route: '/p/[plugin]/[...rest]', files: ['routes/p/[plugin]/[...rest]/+page.ts'], owner: 'none', views: ['redirect'] },
	{ route: '/search', files: ['routes/search/+page.svelte'], owner: '#104', views: ['results', 'selected entry'] },
	{ route: '/search/parts', files: ['routes/search/parts/+page.svelte'], owner: '#106', views: ['radical and parts'] },
	{ route: '/entry/[id]', files: ['routes/entry/[id]/+page.svelte'], owner: '#104', views: ['entry'] },
	{ route: '/stats', files: ['routes/stats/+page.svelte', 'routes/stats/+layout.svelte'], owner: '#105', views: ['overview'] },
	{ route: '/stats/characters', files: ['routes/stats/characters/+page.svelte'], owner: '#105', views: ['characters'] },
	{ route: '/stats/week', files: ['routes/stats/week/+page.svelte'], owner: '#105', views: ['week'] },
	{ route: '/notebook/[...rest]', files: ['routes/notebook/[...rest]/+page.svelte', 'lib/notebook/NotebookPage.svelte'], owner: 'none', views: ['notebook', 'empty notebook', 'practise round'] },
	{ route: '/lookups', files: ['routes/lookups/+page.svelte'], owner: '#106', views: ['history', 'add to deck'] },
	{ route: '/sources', files: ['routes/sources/+page.svelte', 'lib/sources/sections.ts'], owner: '#106', views: ['sources'] }
];
