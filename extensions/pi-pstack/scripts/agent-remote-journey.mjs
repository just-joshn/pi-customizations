export function agentRemoteJourney(check) {
  return async function journeyAgentRemote(ctx) {
    const result = (await ctx.callTool('JOURNEY:agentremote')).find((message) => message.toolName === 'Agent');
    const details = result?.details;
    check(
      'RPC: remote isolation is rejected by the public Agent schema',
      result?.isError === true && result?.content?.[0]?.text.includes('isolation: must be equal to constant'),
      JSON.stringify(result).slice(0, 400),
    );
    check('RPC: unavailable remote request never claims remote_launched', details?.status !== 'remote_launched', JSON.stringify(result).slice(0, 400));
  };
}
