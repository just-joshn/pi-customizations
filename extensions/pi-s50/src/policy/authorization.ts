import { AUTHORIZATION_ACTIONS, type AuthorizationAction, type Gate } from '../domain/state.ts';

export const GATED_ACTIONS: readonly AuthorizationAction[] = AUTHORIZATION_ACTIONS;

export function requiresAuthorization(action: string): action is AuthorizationAction {
  return GATED_ACTIONS.some((gated) => gated === action);
}

export function grantMatches(gate: Gate, action: AuthorizationAction, scope: string): boolean {
  return gate.kind === 'authorization' && gate.action === action && gate.scope === scope;
}
