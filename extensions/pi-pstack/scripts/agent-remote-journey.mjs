export function agentRemoteJourney(check) {
  return async function journeyAgentRemote(ctx) {
    const result = (await ctx.callTool('JOURNEY:agentremote')).find((message) => message.toolName === 'Agent');
    const details = result?.details;
    check(
      'RPC: remote request reports native local fallback outside Git',
      result?.isError !== true && details?.status === 'completed' && details.requestedIsolation === 'remote' && details.effectiveIsolation === 'local',
      JSON.stringify(result).slice(0, 400),
    );
    check('RPC: local fallback never claims remote_launched', details?.status !== 'remote_launched' && details?.content?.[0]?.text.startsWith('recorded Report native fallback.'), JSON.stringify(result).slice(0, 400));
  };
}
