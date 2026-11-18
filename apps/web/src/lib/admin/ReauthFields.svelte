<script lang="ts">
	import { t } from '$lib/i18n';
	import { Field } from '$lib/ui';

	// The acting administrator's own password and, when asked for, their
	// authenticator or recovery code: one set of fields for every destructive
	// admin action. The parent owns the values and calls focusField().
	//
	// Both are Field underlines (#106); the code keeps its one-time-code
	// autofill and no autocapitalisation.
	let {
		password = $bindable(''),
		code = $bindable(''),
		needsCode,
		passwordLabel = t('admin.reauth.ownPassword')
	}: { password?: string; code?: string; needsCode: boolean; passwordLabel?: string } = $props();

	let passwordInput = $state<HTMLInputElement | undefined>(undefined);
	let codeInput = $state<HTMLInputElement | undefined>(undefined);

	export function focusField(which: 'password' | 'code'): void {
		(which === 'code' && codeInput ? codeInput : passwordInput)?.focus();
	}
</script>

<div class="reauth">
	<Field
		label={passwordLabel}
		type="password"
		autocomplete="current-password"
		bind:value={password}
		bind:element={passwordInput}
	/>
	{#if needsCode}
		<Field
			label={t('admin.reauth.code')}
			autocomplete="one-time-code"
			spellcheck="false"
			autocapitalize="off"
			bind:value={code}
			bind:element={codeInput}
		/>
	{/if}
</div>

<style>
	.reauth {
		display: grid;
		gap: var(--space-3);
		margin-top: var(--space-3);
	}
</style>
