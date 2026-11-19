import type { Api, Message, Model, SimpleStreamOptions, Tool } from '@earendil-works/pi-ai';

export type StreamRequest = {
  readonly model: Model<Api>;
  readonly messages: readonly Message[];
  readonly systemPrompt: string;
  readonly tools: readonly Tool[];
  readonly options: SimpleStreamOptions | undefined;
  readonly apiKey: string;
  readonly isOAuth: boolean;
};
