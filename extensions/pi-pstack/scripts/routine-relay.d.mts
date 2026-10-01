import type { Server } from 'node:http';
export function relayEvent(directory: string, input: unknown): Promise<{ accepted: boolean; spooled: boolean }>;
export function startRelay(directory: string, options: { port: number; host?: string }): Promise<Server>;
