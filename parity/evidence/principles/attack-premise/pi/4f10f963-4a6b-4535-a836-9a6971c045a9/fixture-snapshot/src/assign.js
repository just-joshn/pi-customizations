/** Rotates the hot role so no actor holds it on every round. */
export function pickLeader(round, actors) {
  return actors[round % actors.length];
}
