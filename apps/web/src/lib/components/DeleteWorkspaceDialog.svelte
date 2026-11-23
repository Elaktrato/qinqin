<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { onMount, tick } from 'svelte';
	import { t } from '$lib/i18n';
	import { ApiError } from '$lib/api/client';
	import type { Workspace } from '$lib/api/types';
	import { fetchWorkspaceContents, type WorkspaceContents } from '$lib/api/workspaceContents';
	import { confirmLabel, labelMatches } from '$lib/workspaceDelete';
	import { deleteWorkspace } from '$lib/workspaces';
	import Button from '$lib/ui/Button.svelte';
	import Dialog from '$lib/ui/Dialog.svelte';
	import Field from '$lib/ui/Field.svelte';

	// The confirmation for deleting a workspace: a modal Dialog (lib/ui: the
	// browser traps focus in it, makes the page behind inert, Escape closes
	// it except while deleting) that says what goes and asks for the
	// workspace's label to be typed. The opener gets focus back through
	// `onclose`.
	let {
		workspace,
		list,
		onclose
	}: {
		workspace: Workspace;
		list: readonly Workspace[];
		/** `deleted`: the workspace is gone, focus cannot return to its row. */
		onclose: (deleted: boolean) => void;
	} = $props();

	const uid = $props.id();
	const label = $derived(confirmLabel(list, workspace));

	let input = $state<HTMLInputElement | undefined>(undefined);
	let typed = $state('');
	let contents = $state<WorkspaceContents | null>(null);
	let contentsFailed = $state(false);
	let deleting = $state(false);
	let error = $state('');
	let closed = false;

	const ready = $derived(labelMatches(typed, label) && !deleting);

	function finish(deleted: boolean): void {
		if (closed) return;
		closed = true;
		onclose(deleted);
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!ready) return;
		deleting = true;
		error = '';
		try {
			await deleteWorkspace(workspace.id);
			finish(true);
		} catch (err) {
			error =
				err instanceof ApiError && err.status === 409
					? t('app.workspaces.delete.onlyOne')
					: errorText(err, t('app.workspaces.delete.failed'));
			deleting = false;
			await tick();
			input?.focus();
		}
	}

	onMount(() => {
		let alive = true;
		fetchWorkspaceContents(workspace.id).then(
			(found) => {
				if (alive) contents = found;
			},
			() => {
				if (alive) contentsFailed = true;
			}
		);
		return () => {
			alive = false;
		};
	});
</script>

<Dialog
	open
	title={t('app.workspaces.delete.title', { name: label })}
	describedBy="{uid}-what"
	initialFocus="input"
	dismissible={!deleting}
	onclose={() => finish(false)}
>
	<form id="{uid}-form" onsubmit={submit}>
		<div id="{uid}-what">
			<p>{t('app.workspaces.delete.intro')}</p>
			<ul>
				{#if contents}
					<li>{t('app.workspaces.delete.books', { count: contents.books })}</li>
					<li>
						{contents.decks > 0
							? t('app.workspaces.delete.cardsAndDecks', {
									cards: t('app.workspaces.delete.cards', { count: contents.cards }),
									decks: t('app.workspaces.delete.decks', { count: contents.decks })
								})
							: t('app.workspaces.delete.cards', { count: contents.cards })}
					</li>
					<li>{t('app.workspaces.delete.reviews', { count: contents.reviews })}</li>
				{:else}
					<li>{t('app.workspaces.delete.booksUncounted')}</li>
					<li>{t('app.workspaces.delete.cardsUncounted')}</li>
					<li>{t('app.workspaces.delete.reviewsUncounted')}</li>
				{/if}
			</ul>
			{#if !contents && !contentsFailed}
				<p class="hint" aria-live="polite">{t('app.workspaces.delete.counting')}</p>
			{/if}
			<p>{t('app.workspaces.delete.others')}</p>
		</div>

		<Field
			label={t('app.workspaces.delete.typeToConfirm', { name: label }).replace(/<[^>]+>/g, '')}
			id="{uid}-confirm"
			bind:element={input}
			bind:value={typed}
			autocomplete="off"
			spellcheck="false"
			error={error}
		/>

	</form>
	{#snippet actions()}
		<Button onclick={() => finish(false)} disabled={deleting}>{t('common.action.cancel')}</Button>
		<Button type="submit" form="{uid}-form" tone="danger" disabled={!ready} busy={deleting}>
			{deleting ? t('app.workspaces.delete.deleting') : t('app.workspaces.delete.submit')}
		</Button>
	{/snippet}
</Dialog>

<style>
	ul {
		margin: 0.25rem 0 0.75rem;
		padding-left: 1.25rem;
	}

	.hint {
		color: var(--readable-muted);
		margin: 0 0 0.5rem;
	}
</style>
