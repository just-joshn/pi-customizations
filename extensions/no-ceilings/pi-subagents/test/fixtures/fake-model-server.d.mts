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

export function startFakeModelServer(options?: { readonly childMarker?: string; readonly childFile?: string }): Promise<FakeModelServer>;
