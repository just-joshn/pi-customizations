export const TLC_DEADLOCK_STATUS = 11;
export const TLC_INVARIANT_STATUS = 12;
export const TLC_LIVENESS_STATUS = 13;
const tlcBugStatuses = [TLC_INVARIANT_STATUS, TLC_DEADLOCK_STATUS, TLC_LIVENESS_STATUS];

/** The command's exit status for a TLC exit status: 0 clean, 1 a bug found, 2 anything else. */
export const commandExit = (tlcStatus: number) =>
  tlcStatus === 0 ? 0 : tlcBugStatuses.includes(tlcStatus) ? 1 : 2;
