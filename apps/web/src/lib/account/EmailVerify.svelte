<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { apiErrorBody } from '$lib/api/client';
	import { resendEmailCode, verifyEmailCode } from '$lib/api/mfa';
	import { codeFailure, otpAttrs, otpComplete, resendText, sanitizeOtp } from './otpInput';

	// Confirms a self-entered address with the six-digit code the server mailed
	// to it. 403 code_invalid / challenge_expired: this is a signed-in route.
	let { address, resendAfter = 60, onverified }: { address: string; resendAfter?: number; onverified: () => void } = $props();

	const attrs = otpAttrs('email');
	let code = $state('');
	let error = $state('');
	let busy = $state(false);
	let left = $state(0);
	let live = $state('');
	let timer: ReturnType<typeof setInterval> | undefined;

	function countdown(seconds: number) {
		clearInterval(timer);
		left = seconds;
		timer = setInterval(() => {
			left = Math.max(0, left - 1);
			if (left === 0) clearInterval(timer);
		}, 1000);
	}
	onMount(() => {
		// A code was just mailed when this opens.
		countdown(resendAfter);
		live = `A code was sent to ${address}.`;
	});
	onDestroy(() => clearInterval(timer));

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy || !otpComplete(code, 'email')) return;
		busy = true;
		error = '';
		try {
			await verifyEmailCode(code);
			onverified();
		} catch (err) {
			error = codeFailure(apiErrorBody(err), 'Could not check the code.').text;
		} finally {
			busy = false;
		}
	}

	async function resend() {
		if (busy || left > 0) return;
		busy = true;
		error = '';
		try {
			const res = await resendEmailCode();
			countdown(res.resendAfter);
			live = `A new code was sent to ${address}.`;
		} catch (err) {
			error = apiErrorBody(err)?.message || 'Could not send a new code.';
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={submit} class="verify">
	<p>We emailed a 6-digit code to <strong>{address}</strong>. It is valid for 10 minutes.</p>
	<label>
		{attrs.label}
		<input
			name="verify-code"
			inputmode={attrs.inputmode}
			autocomplete={attrs.autocomplete}
			maxlength={attrs.maxlength}
			value={code}
			oninput={(e) => {
				code = sanitizeOtp(e.currentTarget.value, 'email');
				e.currentTarget.value = code;
			}}
			required
		/>
	</label>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<button type="submit" disabled={busy || !otpComplete(code, 'email')}>Confirm address</button>
	<p class="hint">
		{resendText(left)}
		<button type="button" class="link" disabled={busy || left > 0} onclick={resend}>Send a new code</button>
	</p>
	<p class="sr-only" aria-live="polite">{live}</p>
</form>
