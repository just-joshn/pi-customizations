export default function pstackHooksNavigator(pi) {
  pi.registerCommand('hk-nav', {
    handler: async (args, ctx) => {
      const result = await ctx.navigateTree(args.trim());
      ctx.ui.notify(`hk-nav ${JSON.stringify(result)}`, 'info');
    },
  });
  if (process.env.PSTACK_HOOKS_NO_WRITE === '1') {
    pi.on('session_start', () => {
      pi.setActiveTools(pi.getActiveTools().filter((name) => name !== 'write' && name !== 'edit'));
    });
  }
}
