const recipes = ['cli', 'electron', 'library', 'playwright', 'server', 'tui'];
const exact = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);

function linked(attempt, type) {
  return (attempt.observations ?? []).filter(
    (fact) =>
      fact.type === type &&
      fact.provenance === 'protected-runtime' &&
      fact.attemptId === attempt.identity?.attemptId &&
      fact.applicationId === attempt.identity?.applicationId &&
      attempt.calls?.some((call) => call.id === fact.callId && call.modelOrigin === true && call.success === true),
  );
}

function cli(attempt) {
  return linked(attempt, 'exec').some(
    (fact) => fact.executable === attempt.identity.executable && fact.sha256 === attempt.identity.sha256 && exact(fact.argv, ['hello', 'Ada']) && fact.exitCode === 0 && fact.signal === null && fact.stdout === 'Hello Ada\n',
  );
}

function library(attempt) {
  return linked(attempt, 'package-call').some(
    (fact) =>
      fact.specifier === 'greeting-kit' &&
      fact.packageRoot === attempt.identity.packageRoot &&
      fact.resolvedThroughExport === true &&
      fact.exportSha256 === attempt.identity.sha256 &&
      fact.exportName === 'greet' &&
      exact(fact.arguments, ['Ada']) &&
      fact.result === 'Hello Ada' &&
      fact.exitCode === 0,
  );
}

function server(attempt) {
  return linked(attempt, 'http-response').some(
    (response) =>
      response.url === '/greet?name=Ada' &&
      response.status === 200 &&
      response.body === 'Hello Ada\n' &&
      response.port === attempt.identity.port &&
      linked(attempt, 'listener').some((listener) => listener.leaseId === response.leaseId && listener.pid === response.pid && listener.port === response.port && listener.address === '127.0.0.1' && listener.ready === true),
  );
}

function tui(attempt) {
  return linked(attempt, 'pane').some(
    (pane) =>
      pane.socket === attempt.identity.socket &&
      typeof pane.paneId === 'string' &&
      pane.text.split(/\r?\n/).includes('Settings enabled') &&
      linked(attempt, 'terminal-input').some((input) => input.socket === pane.socket && input.paneId === pane.paneId && input.key === 's' && input.leaseId === pane.leaseId && input.sequence < pane.sequence),
  );
}

function gui(attempt) {
  return linked(attempt, 'image-read').some(
    (read) =>
      read.sdkImage === true &&
      attempt.calls.some((call) => call.id === read.callId && call.toolName === 'read') &&
      linked(attempt, 'png').some(
        (png) =>
          png.sha256 === read.sha256 &&
          png.path === read.path &&
          png.valid === true &&
          png.width > 0 &&
          png.height > 0 &&
          png.windowId === read.windowId &&
          png.sequence < read.sequence &&
          linked(attempt, 'visible').some(
            (visible) =>
              visible.windowId === png.windowId &&
              visible.text === 'Hello Ada' &&
              visible.sequence <= png.sequence &&
              linked(attempt, 'click').some(
                (click) =>
                  click.windowId === png.windowId &&
                  click.target === 'Greet Ada' &&
                  click.sequence < visible.sequence &&
                  linked(attempt, 'window-ready').some((ready) => ready.windowId === click.windowId && ready.actual === true && ready.sequence < click.sequence),
              ),
          ),
      ),
  );
}

const interactions = { cli, library, server, tui, electron: gui, playwright: gui };

export function evaluateRun(attempt) {
  const cleanup = attempt.cleanup;
  const requirements = [
    ['recognized recipe', recipes.includes(attempt.kind)],
    ['owned application identity', Boolean(attempt.identity?.attemptId && attempt.identity?.applicationId)],
    ['successful model invocation', attempt.invocation?.error === null],
    [`${attempt.kind} actual correlated interaction`, Boolean(interactions[attempt.kind]?.(attempt))],
    ['agent cleanup before rescue', cleanup?.beforeRescue === true],
    ['complete owned-resource capture', cleanup?.complete === true],
    ['agent-owned resources exited and listeners absent', cleanup?.listenerAbsent === true && cleanup?.socketAbsent === true && Boolean(cleanup?.resources?.every((resource) => resource.alive === false && resource.listenerAbsent === true))],
  ];
  const missing = requirements.filter(([, satisfied]) => !satisfied).map(([requirement]) => requirement);
  return {
    kind: attempt.kind,
    eligible: missing.length === 0,
    verdict: missing.length === 0 && attempt.mode === 'genuine' ? 'inconclusive' : 'failed',
    missing,
    agentCleanup: cleanup,
    rescue: attempt.rescue ?? null,
    genuineCompliance: false,
    reason: missing.length ? missing.join('; ') : 'Complete observations require independent workflow review. Scripted controls never verify genuine compliance.',
  };
}

export function summarizeRuns(attempts) {
  const outcomes = attempts.map(evaluateRun);
  const complete = recipes.every((kind) => outcomes.filter((outcome) => outcome.kind === kind && outcome.eligible).length === 1) && outcomes.length === 6;
  return { eligible: complete, verdict: complete && attempts.every((attempt) => attempt.mode === 'genuine') ? 'inconclusive' : 'failed', genuineCompliance: false, outcomes };
}
