<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { apiErrorBody } from '$lib/api/client';
	import { resetUserMfa } from '$lib/api/adminUsers';
	import { user as me } from '$lib/auth';
	import ReauthFields from './ReauthFields.svelte';
	import { resetError, resetLines, type MfaFactors } from './mfaResetView';
	import { reauthBody, reauthFocus, reauthNeedsCode, reauthReady } from './reauth';

	// Confirmation for resetting someone else's two-step sign-in: says what
	// goes and asks for the acting administrator's own password (and code,
	// when they have an authenticator). A modal <dialog> like the delete
	// dialog; the opener gets focus back through `onclose`.
	let {
		id,
		username,
		mfa,
		onclose,
		ongone
	}: {
		id: number;
		username: string;
		mfa: MfaFactors;
		onclose: (reset: boolean) => void;
		/** The account does not exist any more: the list should reload. */
		ongone: () => void;
	} = $props();

	const uid = $props.id();
	let sawCodeInvalid = $state(false);
	const needsCode = $derived(reauthNeedsCode($me?.mfa?.totp, sawCodeInvalid));
	let dialog = $state<HTMLDialogElement | null>(null);
	let fields = $state<ReturnType<typeof ReauthFields> | null>(null);
	let password = $state('');
	let code = $state('');
	let busy = $state(false);
	let error = $state('');
	let closed = false;

	const ready = $derived(!busy && reauthReady(password, needsCode, code));

	function finish(reset: boolean): void {
		if (closed) return;
		closed = true;
		if (dialog?.open) {
			if (typeof dialog.close === 'function') dialog.close();
			else dialog.removeAttribute('open');
		}
		onclose(reset);
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!ready) return;
		busy = true;
		error = '';
		try {
			await resetUserMfa(id, reauthBody(password, needsCode, code));
			password = code = '';
			finish(true);
		} catch (err) {
			const kind = apiErrorBody(err)?.error;
			error = resetError(kind);
			if (kind === 'not_found') ongone();
			if (kind === 'code_invalid') sawCodeInvalid = true;
			const f = reauthFocus(kind);
			if (f.clear === 'code') code = '';
			if (f.clear === 'password') password = '';
			busy = false;
			await tick();
			fields?.focusField(f.focus);
		}
	}

	onMount(() => {
		if (typeof dialog?.showModal === 'function') dialog.showModal();
		else dialog?.setAttribute('open', '');
		fields?.focusField('password');
	});
</script>

<dialog
	bind:this={dialog}
	aria-labelledby="{uid}-title"
	aria-describedby="{uid}-what"
	oncancel={(event) => {
		event.preventDefault();
		if (!busy) finish(false);
	}}
	onclose={() => finish(false)}
>
	<form onsubmit={submit}>
		<h2 id="{uid}-title">Reset two-step sign-in for “{username}”?</h2>
		<ul id="{uid}-what">
			{#each resetLines(mfa) as line (line)}<li>{line}</li>{/each}
		</ul>
		<ReauthFields bind:this={fields} bind:password bind:code {needsCode} />
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<div class="buttons">
			<button type="button" onclick={() => finish(false)} disabled={busy}>Cancel</button>
			<button type="submit" class="danger" disabled={!ready}>Reset two-step sign-in</button>
		</div>
	</form>
</dialog>

<style>
	dialog {
		max-width: min(34rem, calc(100vw - 2rem));
		padding: 1.2rem;
	}
	.buttons {
		display: flex;
		gap: 0.6rem;
		justify-content: flex-end;
		margin-top: 1rem;
	}
	.error {
		color: #c62828;
		font-weight: 600;
	}
	.danger {
		background: #b3261e;
		border-color: #b3261e;
		color: #fff;
	}
	button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
</style>
