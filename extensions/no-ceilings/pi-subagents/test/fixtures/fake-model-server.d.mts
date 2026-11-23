export interface FakeModelRequest {
  readonly model: string;
  readonly messages: readonly { readonly role: string; readonly content: unknown }[];
  readonly tools?: readonly unknown[];
}

export interface FakeModelServer {
  readonly url: string;
  readonly requests: FakeModelRequest[];
  readonly close: () => Promise<void>;
}

export function startFakeModelServer(options?: {
  readonly childMarker?: string;
  readonly childFile?: string;
  readonly onRequest?: (context: {
    readonly body: FakeModelRequest;
    readonly messages: FakeModelRequest['messages'];
    readonly isChild: boolean;
    readonly hasToolResult: boolean;
    readonly model: string;
    readonly response: import('node:http').ServerResponse;
    readonly streamText: (response: import('node:http').ServerResponse, model: string, text: string) => void;
    readonly streamToolCall: (response: import('node:http').ServerResponse, model: string, call: { readonly id: string; readonly name: string; readonly args: unknown }) => void;
  }) => Promise<boolean> | boolean;
}): Promise<FakeModelServer>;
