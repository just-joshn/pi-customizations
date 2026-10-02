export const FIRST_ACTION_RULE_TYPE = 'pstack-first-action';

// At lower effort settings Anthropic models skip the two tool calls poteto-mode opens with: reading
// the playbook and writing its todolist. A soft reminder did not change that and an imperative rule
// did. The rule is sent at every effort so the behavior never depends on the setting.
export function firstActionRule({ playbooksDir, playbooks }: { playbooksDir: string; playbooks: readonly string[] }): string {
  return `poteto-mode is active. For any turn that gives you a task, your first tool call must read the matching playbook in ${playbooksDir} (${playbooks.join(', ')}). Your second tool call must be TodoWrite with that playbook's steps copied in verbatim. Do not read code, run commands, or edit before both calls are done. Skip this only for casual chat or when the user opted out of poteto-mode.`;
}

export function usesAnthropicMessages(model: { api: string } | undefined): boolean {
  return model?.api === 'anthropic-messages';
}
