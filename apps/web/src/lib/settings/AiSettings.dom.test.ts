import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiStatus, ProviderInfo, ProvidersResponse, StoredKey } from '$lib/api/ai';

vi.mock('$lib/api/ai', () => ({
	getAiStatus: vi.fn(),
	getAiProviders: vi.fn(),
	saveAiKey: vi.fn(),
	setAiModel: vi.fn(),
	testAiKey: vi.fn(),
	deleteAiKey: vi.fn(),
	setActiveProvider: vi.fn(),
	createCustomProvider: vi.fn(),
	updateCustomProvider: vi.fn(),
	deleteCustomProvider: vi.fn()
}));

import * as ai from '$lib/api/ai';
import { ApiError } from '$lib/api/client';
import AiSettings from './AiSettings.svelte';

const m = vi.mocked(ai);

const prov = (over: Partial<ProviderInfo> & { id: string; name: string }): ProviderInfo => ({
	kind: 'openai', custom: false, keyRequired: true, defaultModel: 'm', models: [{ id: 'm', label: 'M' }],
	structured: 'json_schema', vision: true, ...over
});

const ANTHROPIC = prov({ id: 'anthropic', name: 'Anthropic', kind: 'anthropic', defaultModel: 'claude-opus-5-5', keyUrl: 'https://platform.claude.com/settings/keys', models: [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }, { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }] });
const OPENAI = prov({ id: 'openai', name: 'OpenAI', defaultModel: 'gpt-6-astra', keyUrl: 'https://platform.openai.com/api-keys', models: [{ id: 'gpt-6-astra', label: 'GPT-6 Astra' }] });
const DEEPSEEK = prov({ id: 'deepseek', name: 'DeepSeek', defaultModel: 'deepseek-flash', structured: 'json_object', models: [{ id: 'deepseek-flash', label: 'DeepSeek Flash', vision: true }, { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', vision: false }] });
const CUSTOM = prov({ id: 'custom-abcdefghij', name: 'Company gateway', custom: true, host: 'llm.example.com', keyRequired: false, defaultModel: 'llama3', models: [{ id: 'llama3', label: 'llama3' }], structured: 'json_object' });
const KEYLESS_SECOND = prov({ id: 'custom-zzzzzzzzzz', name: 'Needs key', custom: true, host: 'k.example.com', keyRequired: true, defaultModel: 'x', models: [{ id: 'x', label: 'x' }] });

const key = (provider: string, model: string, over: Partial<StoredKey> = {}): StoredKey => ({ provider, hint: '…1234', model, state: 'ok', createdAt: '', ...over });

function status(over: Partial<AiStatus> = {}): AiStatus {
	return {
		secret: 'ok', provider: '', fake: false, key: null, keys: [], active: null, models: [],
		usage: { callsLastHour: 0, limitPerHour: 30, inputTokens: 0, outputTokens: 0 },
		available: false, reason: 'no_key', ...over
	};
}
const active = (provider: string, name: string, model: string) => ({ provider, name, model, vision: true, structured: 'json_schema' as const });

function providers(over: Partial<ProvidersResponse> = {}): ProvidersResponse {
	return { providers: [ANTHROPIC, OPENAI, DEEPSEEK, CUSTOM], canManageCustom: false, privateAllowed: false, ...over };
}

const configured = status({
	keys: [key('anthropic', 'claude-opus-5-5'), key('openai', 'gpt-6-astra')],
	active: active('anthropic', 'Anthropic', 'claude-opus-5-5'), available: true, reason: '', provider: 'anthropic'
});

function setup(st: AiStatus, pr: ProvidersResponse = providers()) {
	m.getAiStatus.mockResolvedValue(st);
	m.getAiProviders.mockResolvedValue(pr);
	return render(AiSettings);
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const rows = () => within(screen.getByRole('list', { name: 'Your providers' })).getAllByRole('listitem');

describe('Settings → AI', () => {
	it('renders configured rows with Active first', async () => {
		setup(status({ ...configured, active: active('openai', 'OpenAI', 'gpt-6-astra') }));
		await screen.findByRole('list', { name: 'Your providers' });
		const r = rows();
		expect(r).toHaveLength(2);
		expect(within(r[0]).getByText('OpenAI')).toBeTruthy();
		expect(within(r[0]).getByText('Active')).toBeTruthy();
		expect(within(r[1]).queryByText('Active')).toBeNull();
		expect(within(r[0]).getByText('Reads photos')).toBeTruthy();
		expect(within(r[0]).getByText('GPT-6 Astra')).toBeTruthy();
	});

	it('adding a key calls saveAiKey with the selected provider and clears the field', async () => {
		setup(status());
		const select = (await screen.findByLabelText('Provider')) as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'deepseek' } });
		const input = screen.getByLabelText('API key') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: '  sk-fake-deepseek-key-0001  ' } });
		m.saveAiKey.mockResolvedValue(status({ keys: [key('deepseek', 'deepseek-flash')], active: active('deepseek', 'DeepSeek', 'deepseek-flash'), available: true, reason: '' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(m.saveAiKey).toHaveBeenCalledWith('deepseek', 'sk-fake-deepseek-key-0001', 'deepseek-flash'));
		await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Saved'));
		expect((screen.queryByLabelText('API key') as HTMLInputElement | null)?.value ?? '').toBe('');
		expect(within(rows()[0]).getByText('DeepSeek')).toBeTruthy();
	});

	it('clears the key field also when saving fails, and shows the error', async () => {
		setup(status());
		await fireEvent.change(await screen.findByLabelText('Provider'), { target: { value: 'openai' } });
		const input = screen.getByLabelText('API key') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'sk-fake-bad-key-0001xxxxx' } });
		m.saveAiKey.mockRejectedValue(new ApiError(422, JSON.stringify({ error: 'key_rejected', message: 'The provider rejected the API key.' })));
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('The provider rejected the API key.'));
		expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('');
	});

	it('key field is password and never prefilled', async () => {
		setup(configured);
		await fireEvent.change(await screen.findByLabelText('Provider'), { target: { value: 'deepseek' } });
		const input = screen.getByLabelText('API key') as HTMLInputElement;
		expect(input.type).toBe('password');
		expect(input.value).toBe('');
		expect(input.getAttribute('autocomplete')).toBe('off');
		expect(document.body.innerHTML).not.toContain('sk-');
	});

	it('Make active calls setActiveProvider and moves the badge', async () => {
		setup(configured);
		await screen.findByRole('list', { name: 'Your providers' });
		m.setActiveProvider.mockResolvedValue(status({ ...configured, active: active('openai', 'OpenAI', 'gpt-6-astra') }));
		await fireEvent.click(within(rows()[1]).getByRole('button', { name: /Make OpenAI active/ }));
		await waitFor(() => expect(m.setActiveProvider).toHaveBeenCalledWith('openai'));
		await waitFor(() => expect(within(rows()[0]).getByText('OpenAI')).toBeTruthy());
		expect(within(rows()[0]).getByText('Active')).toBeTruthy();
		expect(within(rows()[0]).queryByRole('button', { name: /Make .* active/ })).toBeNull();
	});

	it('Test key reports the result', async () => {
		setup(configured);
		await screen.findByRole('list', { name: 'Your providers' });
		m.testAiKey.mockResolvedValue(configured);
		await fireEvent.click(within(rows()[0]).getByRole('button', { name: /Test Anthropic key/ }));
		await waitFor(() => expect(m.testAiKey).toHaveBeenCalledWith('anthropic'));
		await waitFor(() => expect(screen.getByRole('status').textContent).toContain('works'));
	});

	it('Change model saves a free-text id', async () => {
		setup(configured);
		await screen.findByRole('list', { name: 'Your providers' });
		await fireEvent.click(within(rows()[0]).getByRole('button', { name: /Change Anthropic model/ }));
		const input = screen.getByLabelText('Model for Anthropic') as HTMLInputElement;
		expect(input.getAttribute('list')).toBeTruthy();
		await fireEvent.input(input, { target: { value: 'claude-haiku-5-5' } });
		m.setAiModel.mockResolvedValue(configured);
		await fireEvent.click(screen.getByRole('button', { name: 'Save model' }));
		await waitFor(() => expect(m.setAiModel).toHaveBeenCalledWith('anthropic', 'claude-haiku-5-5'));
	});

	it('Remove asks for confirmation; Escape cancels and returns focus', async () => {
		setup(configured);
		await screen.findByRole('list', { name: 'Your providers' });
		const remove = within(rows()[1]).getByRole('button', { name: /Remove OpenAI key/ });
		await fireEvent.click(remove);
		const group = within(rows()[1]).getByRole('group', { name: /Remove the OpenAI key\?/ });
		expect(m.deleteAiKey).not.toHaveBeenCalled();
		await fireEvent.keyDown(group, { key: 'Escape' });
		await waitFor(() => expect(within(rows()[1]).queryByRole('group')).toBeNull());
		expect(document.activeElement).toBe(within(rows()[1]).getByRole('button', { name: /Remove OpenAI key/ }));
		await fireEvent.click(within(rows()[1]).getByRole('button', { name: /Remove OpenAI key/ }));
		m.deleteAiKey.mockResolvedValue(undefined);
		m.getAiStatus.mockResolvedValue(status({ keys: [key('anthropic', 'claude-opus-5-5')], active: active('anthropic', 'Anthropic', 'claude-opus-5-5'), available: true, reason: '' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
		await waitFor(() => expect(m.deleteAiKey).toHaveBeenCalledWith('openai'));
		await waitFor(() => expect(rows()).toHaveLength(1));
	});

	it('custom endpoint form hidden for non-admins and shown for admins', async () => {
		setup(configured);
		await screen.findByRole('list', { name: 'Your providers' });
		expect(screen.queryByRole('heading', { name: 'Custom endpoints' })).toBeNull();
		cleanup();
		setup(configured, providers({ canManageCustom: true }));
		expect(await screen.findByRole('heading', { name: 'Custom endpoints' })).toBeTruthy();
		expect(screen.getByLabelText('Base URL')).toBeTruthy();
	});

	it('endpoint_blocked message is linked to the URL field', async () => {
		setup(configured, providers({ canManageCustom: true }));
		await fireEvent.input(await screen.findByLabelText('Name'), { target: { value: 'Local' } });
		const url = screen.getByLabelText('Base URL') as HTMLInputElement;
		await fireEvent.input(url, { target: { value: 'http://169.254.169.254/v1' } });
		await fireEvent.input(screen.getByLabelText('Default model'), { target: { value: 'm' } });
		m.createCustomProvider.mockRejectedValue(new ApiError(422, JSON.stringify({ error: 'endpoint_blocked', message: 'That address is never allowed.' })));
		await fireEvent.click(screen.getByRole('button', { name: 'Add endpoint' }));
		const msg = await screen.findByText('That address is never allowed.');
		expect(msg.id).toBeTruthy();
		expect(url.getAttribute('aria-describedby')).toContain(msg.id);
		expect(url.getAttribute('aria-invalid')).toBe('true');
	});

	it('creating an endpoint sends the form and reloads', async () => {
		setup(configured, providers({ canManageCustom: true }));
		await fireEvent.input(await screen.findByLabelText('Name'), { target: { value: 'Local' } });
		await fireEvent.input(screen.getByLabelText('Base URL'), { target: { value: 'https://llm.example.com/v1' } });
		await fireEvent.input(screen.getByLabelText('Default model'), { target: { value: 'llama3' } });
		await fireEvent.click(screen.getByLabelText('Reads photos'));
		m.createCustomProvider.mockResolvedValue(CUSTOM);
		await fireEvent.click(screen.getByRole('button', { name: 'Add endpoint' }));
		await waitFor(() => expect(m.createCustomProvider).toHaveBeenCalledWith({
			name: 'Local', baseUrl: 'https://llm.example.com/v1', defaultModel: 'llama3', vision: true, keyRequired: true, structured: 'json_object'
		}));
		await waitFor(() => expect(m.getAiProviders).toHaveBeenCalledTimes(2));
	});

	it('privacy note names the chosen provider and links to the key page', async () => {
		setup(status());
		await fireEvent.change(await screen.findByLabelText('Provider'), { target: { value: 'deepseek' } });
		const note = screen.getByTestId('privacy-note');
		expect(note.getAttribute('aria-live')).toBe('polite');
		expect(note.textContent).toContain("sent to DeepSeek when you press a button. DeepSeek's terms apply.");
		await fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai' } });
		expect(screen.getByTestId('privacy-note').textContent).toContain('sent to OpenAI');
		const link = screen.getByRole('link', { name: /Get a key/ });
		expect(link.getAttribute('href')).toBe('https://platform.openai.com/api-keys');
		expect(link.getAttribute('rel')).toBe('noopener noreferrer');
	});

	it('keyless custom endpoint allows an empty key', async () => {
		setup(status());
		await fireEvent.change(await screen.findByLabelText('Provider'), { target: { value: 'custom-abcdefghij' } });
		expect(screen.getByText(/Optional/)).toBeTruthy();
		const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
		expect(save.disabled).toBe(false);
		m.saveAiKey.mockResolvedValue(status({ keys: [key('custom-abcdefghij', 'llama3')], active: active('custom-abcdefghij', 'Company gateway', 'llama3'), available: true, reason: '' }));
		await fireEvent.click(save);
		await waitFor(() => expect(m.saveAiKey).toHaveBeenCalledWith('custom-abcdefghij', '', 'llama3'));
	});

	it('requires a key for providers that need one', async () => {
		setup(status());
		await fireEvent.change(await screen.findByLabelText('Provider'), { target: { value: 'openai' } });
		expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('custom endpoint key form shows the admin and host line', async () => {
		setup(status(), providers({ providers: [ANTHROPIC, CUSTOM, KEYLESS_SECOND] }));
		await fireEvent.change(await screen.findByLabelText('Provider'), { target: { value: 'custom-abcdefghij' } });
		expect(screen.getByText('Added by your admin · llm.example.com')).toBeTruthy();
		const groups = Array.from(document.querySelectorAll('optgroup')).map((g) => g.label);
		expect(groups).toEqual(['Built in', 'Added by your admin']);
	});

	it('disabled provider row offers Remove only', async () => {
		setup(status({
			keys: [key('gemini', 'gemini-3.8-flash')], disabledProviders: ['gemini'], reason: 'no_selection'
		}));
		await screen.findByRole('list', { name: 'Your providers' });
		const row = rows()[0];
		expect(within(row).getByText('Turned off by the server')).toBeTruthy();
		expect(within(row).getByRole('button', { name: /Remove Google Gemini key/ })).toBeTruthy();
		expect(within(row).queryByRole('button', { name: /Make|Test|Change/ })).toBeNull();
	});

	it('shows the banner and no form when the server cannot store keys', async () => {
		setup(status({ secret: 'missing', reason: 'no_secret' }));
		expect(await screen.findByText(/has not set QINQIN_SECRET/)).toBeTruthy();
		expect(screen.queryByLabelText('Provider')).toBeNull();
	});

	it('flags the fake provider', async () => {
		setup(status({ fake: true }));
		expect(await screen.findByText('Test provider — no real AI')).toBeTruthy();
	});
});
