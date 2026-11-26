<script lang="ts">
	// The writing-system trainer (#204, kana #63): the chart of a writing system and its practice rounds. The page
	// owns the progress of the workspace (derived from its `script` events, plus answers still waiting to be sent)
	// and records each answer; the views only show and ask.
	import { t } from '$lib/i18n';
	import { pageTitle } from '$lib/routing/pageTitle';
	import { useSession } from '$lib/context/context';
	import { writingSystemsOf } from '$lib/languages/profiles';
	import { readAudioSettings } from '$lib/audio/settings';
	import { newUlid } from '$lib/events/ulid';
	import type { StudyEventBody } from '$lib/api/types';
	import { Button } from '$lib/ui';
	import { scriptPayload } from './events';
	import { systemLabel } from './labels';
	import { systemsFor } from './packs';
	import { clearDropped, flushPending, mergeLog, readDropped, readPending, withoutSent, writePending } from './pending';
	import { applyAnswer, deriveProgress, type ItemState } from './progress';
	import { parseScriptsRoute } from './route';
	import ScriptsOverview from './ScriptsOverview.svelte';
	import ScriptsPracticeRun from './ScriptsPracticeRun.svelte';
	import type { Question } from './types';

	let { rest }: { rest: string } = $props();

	const session = useSession();
	const workspace = $derived(session.workspaces.current);
	const systems = $derived(workspace === null ? [] : systemsFor(writingSystemsOf(workspace.language)));
	const route = $derived(parseScriptsRoute(rest, systems.map((s) => s.id)));
	const system = $derived(systems.find((s) => s.id === route.system));
	const deviceVoice = $derived(readAudioSettings(workspace?.settings).deviceVoice);

	let progress = $state.raw<ReadonlyMap<string, ItemState>>(new Map());
	let status = $state<'loading' | 'ready' | 'error'>('loading');
	let seq = 0;

	function storage(): Storage | null {
		try {
			return typeof localStorage === 'undefined' ? null : localStorage;
		} catch {
			return null;
		}
	}

	// What waited from an earlier, offline round is also sent by the app shell on start, on coming online and on coming back to the front.
	let dropped = $state(0);

	function dismissDropped(): void {
		if (workspace === null) return;
		clearDropped(storage(), workspace.id);
		dropped = 0;
	}

	$effect(() => {
		const id = workspace?.id;
		if (id === undefined) return;
		const mine = ++seq;
		status = 'loading';
		void (async () => {
			await flushPending(storage(), id, (events) => session.events.post(events));
			dropped = readDropped(storage(), id);
			try {
				const log = await session.events.load(id, { force: true });
				if (mine !== seq) return;
				progress = deriveProgress(mergeLog(log.filter((e) => e.workspaceId === id), readPending(storage(), id)));
				status = 'ready';
			} catch {
				if (mine === seq) {
					// Offline: what waits on this device still counts.
					progress = deriveProgress(readPending(storage(), id));
					status = 'error';
				}
			}
		})();
	});

	function answer(q: Question, ok: boolean): void {
		const ws = workspace;
		if (ws === null) return;
		const now = Date.now();
		const next = new Map(progress);
		next.set(q.itemId, applyAnswer(next.get(q.itemId), ok, now));
		progress = next;
		const event: StudyEventBody = {
			id: newUlid(now),
			workspaceId: ws.id,
			device: 'web',
			ts: new Date(now).toISOString(),
			type: 'script',
			payload: scriptPayload(q.system, q.itemId, q.mode, ok)
		};
		dropped += writePending(storage(), ws.id, [...readPending(storage(), ws.id), event]);
		void session.events.post([event]).then(
			() => writePending(storage(), ws.id, withoutSent(readPending(storage(), ws.id), new Set([event.id]))),
			() => undefined
		);
	}

	const title = $derived(system === undefined ? '' : systemLabel(system.id));
</script>

<svelte:head>
	<title>{pageTitle(title, t('scripts.title'))}</title>
</svelte:head>

<div class="page-body scripts">
	<h1>{t('scripts.title')}</h1>

	{#if dropped > 0 && workspace !== null}
		<p class="warn" role="alert" data-testid="scripts-pending-dropped">
			{t('scripts.pendingDropped', { count: dropped })}
			<Button variant="plain" onclick={dismissDropped}>{t('scripts.pendingDroppedDismiss')}</Button>
		</p>
	{/if}

	{#if workspace === null}
		<p>{t('scripts.chooseWorkspace')}</p>
	{:else if system === undefined}
		<p>{t('scripts.noSystems')}</p>
	{:else}
		{#if status === 'error'}
			<p class="notice" role="status">{t('scripts.loadFailed')}</p>
		{/if}
		{#if status === 'loading'}
			<p role="status">{t('common.loading')}</p>
		{:else if route.view === 'practice'}
			{#key `${system.id}/${route.mode}`}
				<ScriptsPracticeRun {system} mode={route.mode} {progress} {deviceVoice} onanswer={answer} />
			{/key}
		{:else}
			<ScriptsOverview {system} {systems} {progress} {deviceVoice} />
		{/if}
	{/if}
</div>

<style>
	.warn {
		color: var(--readable-muted);
	}
	.notice {
		color: var(--readable-muted);
	}
</style>
