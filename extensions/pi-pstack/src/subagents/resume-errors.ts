export type ResumeErrorCode = 'busy' | 'still_stopping' | 'transient' | 'permanent' | 'user_stopped' | 'state';

const names: Readonly<Record<ResumeErrorCode, string>> = {
  busy: 'AgentResumeInProgressError',
  still_stopping: 'AgentStillStoppingError',
  transient: 'AgentResumeTransientError',
  permanent: 'AgentResumePermanentlyRefusedError',
  user_stopped: 'AgentStoppedBy' + 'UserError',
  state: 'ResumeAgentStateError',
};

export class ResumeError extends Error {
  readonly code: ResumeErrorCode;

  constructor(code: ResumeErrorCode, message: string) {
    super(message);
    this.name = names[code];
    this.code = code;
  }
}

export const resumeMessages = {
  busy: (id: string) => `Agent ${id} is already running or being resumed`,
  resumerStopping: 'This agent has been stopped and its stop is still completing; it cannot resume other agents.',
  targetStopping: (id: string) => `Agent ${id} is still stopping — its previous run was stopped but has not exited. Re-run TaskStop on it or wait for it to exit before resuming.`,
  userStopped: (id: string) => `Agent ${id} was stopped by the user and won't be resumed. Treat its work as cancelled; only launch a new agent if the user explicitly asks.`,
  transcriptMissing: (id: string) => `No transcript found for agent ID: ${id}`,
  notOffered: (type: string) => `Agent type '${type}' is not offered in this session.`,
} as const;
