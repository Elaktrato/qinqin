<script lang="ts">
	// The acting administrator's own password and, when asked for, their
	// authenticator or recovery code: one set of fields for every destructive
	// admin action. The parent owns the values and calls focusField().
	let {
		password = $bindable(''),
		code = $bindable(''),
		needsCode,
		passwordLabel = 'Your own password'
	}: { password?: string; code?: string; needsCode: boolean; passwordLabel?: string } = $props();

	let passwordInput = $state<HTMLInputElement | null>(null);
	let codeInput = $state<HTMLInputElement | null>(null);

	export function focusField(which: 'password' | 'code'): void {
		(which === 'code' && codeInput ? codeInput : passwordInput)?.focus();
	}
</script>

<label>
	{passwordLabel}
	<input bind:this={passwordInput} type="password" autocomplete="current-password" bind:value={password} />
</label>
{#if needsCode}
	<label>
		Authenticator or recovery code (yours)
		<input
			bind:this={codeInput}
			autocomplete="one-time-code"
			spellcheck="false"
			autocapitalize="off"
			bind:value={code}
		/>
	</label>
{/if}

<style>
	label {
		display: grid;
		gap: 0.3rem;
		margin-top: 0.8rem;
	}
	input {
		font: inherit;
		padding: 0.45rem 0.6rem;
	}
</style>
