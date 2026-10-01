function lastUserText(request) {
  const user = request.messages?.findLast((message) => message.role === 'user');
  if (typeof user?.content === 'string') return user.content;
  return (
    user?.content
      ?.filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('') ?? ''
  );
}

async function requestFor(ctx, text, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const found = (await ctx.everyRequest()).find((request) => lastUserText(request) === text);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return undefined;
}

export function agentResumeStopJourney(check) {
  return async function journeyAgentResumeStop(ctx) {
    const messages = await ctx.callTool('JOURNEY:agentstopresume');
    const stopped = messages.find((message) => message.toolName === 'TaskStop');
    const sent = messages.find((message) => message.toolName === 'SendMessage');
    check(
      'RPC: a model SendMessage does not restart an agent the user stopped',
      stopped?.details?.status === 'interrupted' && sent?.isError === true && JSON.stringify(sent).includes("was stopped by the user and won't be resumed"),
      String(JSON.stringify(sent)).slice(0, 300),
    );
    check('RPC: the refused SendMessage produced no child request', (await requestFor(ctx, 'JOURNEY:model-restart', 200)) === undefined);
    await ctx.run(`/resume-agent ${stopped?.details?.task_id} JOURNEY:user-resumed`);
    const resumed = await requestFor(ctx, 'JOURNEY:user-resumed', 20000);
    check('RPC: /resume-agent restarts the user-stopped agent with its history', resumed !== undefined && JSON.stringify(resumed.messages).includes('JOURNEY:agentstop-child'), JSON.stringify(resumed?.messages ?? []).slice(0, 300));
  };
}
