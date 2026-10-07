export default function pstackHooksSelector(pi) {
  const agent = process.env.PSTACK_HOOKS_SELECT_AGENT;
  if (!agent) return;
  pi.on('session_start', () => {
    pi.events.emit('reference-assistant:rpc', { id: 'hk-select', method: 'session.agent.select', params: { name: agent } });
  });
}
