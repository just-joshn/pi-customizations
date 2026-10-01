export function agentGuidanceJourney(check) {
  return async function journeyAgentGuidance(ctx) {
    const request = await ctx.turn('JOURNEY:guidance');
    const tools = request.tools ?? (request.messages ?? []).flatMap((message) => (message.role === 'system' ? (message.toolsAdded ?? []) : []));
    const description = tools.find((tool) => tool.name === 'Agent')?.description ?? '';
    const phrases = ['Always include a short description', 'Trust but verify', 'a new Agent call starts fresh', 'Never delegate understanding', 'If the target is already known, use the direct tool'];
    check(
      'RPC: model receives Agent decision and prompt guidance',
      phrases.every((phrase) => description.includes(phrase)),
      description.slice(0, 300),
    );
    check('RPC: Agent guidance does not advertise unsupported conversation forks', !description.includes('## When to fork'), description.slice(0, 300));
  };
}
