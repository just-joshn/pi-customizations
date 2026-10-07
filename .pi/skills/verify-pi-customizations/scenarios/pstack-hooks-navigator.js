export default function pstackHooksNavigator(pi) {
  pi.registerCommand('hk-nav', {
    handler: async (args, ctx) => {
      const result = await ctx.navigateTree(args.trim());
      ctx.ui.notify(`hk-nav ${JSON.stringify(result)}`, 'info');
    },
  });
  pi.registerCommand('hk-gate', {
    handler: async (args, ctx) => {
      const mode = args.trim();
      const before = pi.getActiveTools();
      const next = mode === 'plan' ? before.filter((name) => name !== 'write' && name !== 'edit') : [...new Set([...before, 'write', 'edit'])].filter((name) => pi.getAllTools().some((tool) => tool.name === name));
      pi.setActiveTools(next);
      ctx.ui.notify(`hk-gate ${mode} before=${JSON.stringify(before)} active=${JSON.stringify(pi.getActiveTools())}`, 'info');
    },
  });
  if (process.env.PSTACK_HOOKS_NO_WRITE === '1') {
    pi.on('session_start', () => {
      pi.setActiveTools(pi.getActiveTools().filter((name) => name !== 'write' && name !== 'edit'));
    });
  }
}
