<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { apiErrorBody } from '$lib/api/client';
	import { resetUserMfa } from '$lib/api/adminUsers';
	import { user as me } from '$lib/auth';
	import { canSubmit, focusAfterError, resetError, resetLines, type MfaFactors } from './mfaResetView';

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
	const needsCode = $derived(!!$me?.mfa?.totp);
	let dialog = $state<HTMLDialogElement | null>(null);
	let passwordInput = $state<HTMLInputElement | null>(null);
	let codeInput = $state<HTMLInputElement | null>(null);
	let password = $state('');
	let code = $state('');
	let busy = $state(false);
	let error = $state('');
	let closed = false;

	const ready = $derived(canSubmit(password, busy, needsCode, code));

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
			await resetUserMfa(id, password, needsCode ? code.trim() : undefined);
			password = code = '';
			finish(true);
		} catch (err) {
			const kind = apiErrorBody(err)?.error;
			error = resetError(kind);
			if (kind === 'not_found') ongone();
			const target = focusAfterError(kind);
			if (target === 'code') code = '';
			else if (kind === 'wrong_password') password = '';
			busy = false;
			await tick();
			(target === 'code' ? codeInput : passwordInput)?.focus();
		}
	}

	onMount(() => {
		if (typeof dialog?.showModal === 'function') dialog.showModal();
		else dialog?.setAttribute('open', '');
		passwordInput?.focus();
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
		<label>
			Your own password
			<input bind:this={passwordInput} type="password" autocomplete="current-password" bind:value={password} />
		</label>
		{#if needsCode}
			<label>
				Authenticator or recovery code (yours)
				<input bind:this={codeInput} autocomplete="one-time-code" bind:value={code} />
			</label>
		{/if}
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
	label {
		display: grid;
		gap: 0.3rem;
		margin-top: 0.8rem;
	}
	input {
		font: inherit;
		padding: 0.45rem 0.6rem;
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
