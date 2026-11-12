/** Default upload language: the workspace language when the reader supports it, else detect from the file. */
export function initialUploadLanguage(workspaceLanguage: string | null): 'zh' | 'ja' | '' {
	return workspaceLanguage === 'zh' || workspaceLanguage === 'ja' ? workspaceLanguage : '';
}
