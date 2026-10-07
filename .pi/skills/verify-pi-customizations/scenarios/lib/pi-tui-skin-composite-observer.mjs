#!/usr/bin/env node
/**
 * Observer adapter for the F-014 composite drive.
 *
 * A frame cannot show a teardown: the surfaces are gone by the time the next
 * capture is taken. This wrapper is the extension entrypoint instead of the
 * production `src/index.ts`. It calls the production default export with a
 * proxy whose `ui` property records every `ctx.ui.<method>` call and delegates
 * to the real UI object, so the rendered terminal behaviour is unchanged and
 * every cleanup call is observed as it happens. Nothing on the production
 * object is mutated or replaced.
 *
 * `__ENTRY__` is replaced with the absolute path of the module under test, so
 * the same wrapper drives the live entrypoint and an isolated mutant copy.
 */

export const COMPOSITE_OBSERVER_SOURCE = `import { appendFileSync } from 'node:fs';
import tuiSkin from '__ENTRY__';

const RECORD = process.env.COMPOSITE_OBSERVER_PATH;

function record(entry) {
  if (RECORD) appendFileSync(RECORD, \`\${JSON.stringify(entry)}\\n\`);
}

function wrapUi(ui, sink) {
  return new Proxy(ui, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      return (...args) => {
        sink.push({ method: String(prop), args: args.map((arg) => (typeof arg === 'function' ? '<fn>' : arg === undefined ? null : arg)) });
        return Reflect.apply(value, target, args);
      };
    },
  });
}

function wrapCtx(ctx, sink) {
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop === 'ui') return wrapUi(target.ui, sink);
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export default function compositeObserver(pi) {
  let shutdownHandler;
  const wrapped = new Proxy(pi, {
    get(target, prop) {
      if (prop === 'on') {
        return (event, handler) => {
          if (event === 'session_shutdown') shutdownHandler = handler;
          if (event === 'session_start' || event === 'session_shutdown') {
            return target.on(event, (e, ctx) => {
              const sink = [];
              const result = handler(e, wrapCtx(ctx, sink));
              record({ event, calls: sink });
              return result;
            });
          }
          return target.on(event, handler);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  tuiSkin(wrapped);
  pi.on('session_shutdown', (event, ctx) => {
    const sink = [];
    let error = null;
    try {
      shutdownHandler?.(event, wrapCtx(ctx, sink));
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    record({ event: 'session_shutdown_repeat', error, calls: sink });
  });
}
`;
