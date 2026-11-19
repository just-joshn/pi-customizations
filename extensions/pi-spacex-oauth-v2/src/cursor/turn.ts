import { type Api, type AssistantMessage, type AssistantMessageEventStream, createAssistantMessageEventStream, type JsonObject, type Model, type ToolCall } from '@earendil-works/pi-ai';

export interface PiToolCall {
  id: string;
  name: string;
  arguments: JsonObject;
}

/**
 * One Pi assistant message. A Cursor run can span several of these: each tool pause ends one with
 * toolUse, and the run continues into the next. Usage stays zero, because the SDK reports usage per run
 * (summed across model calls), which is not the context size Pi tracks; Pi estimates context instead.
 */
export class PiTurn {
  readonly stream: AssistantMessageEventStream = createAssistantMessageEventStream();
  readonly message: AssistantMessage;
  private open: { kind: 'text' | 'thinking'; index: number } | undefined;
  private ended = false;

  constructor(model: Model<Api>) {
    this.message = {
      role: 'assistant',
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'pending',
      timestamp: Date.now(),
    };
    this.stream.push({ type: 'start', partial: this.message });
  }

  get isEnded(): boolean {
    return this.ended;
  }

  text(delta: string): void {
    const index = this.openBlock('text');
    const block = this.message.content[index];
    if (block?.type !== 'text') return;
    block.text += delta;
    this.stream.push({ type: 'text_delta', contentIndex: index, delta, partial: this.message });
  }

  thinking(delta: string): void {
    const index = this.openBlock('thinking');
    const block = this.message.content[index];
    if (block?.type !== 'thinking') return;
    block.thinking += delta;
    this.stream.push({ type: 'thinking_delta', contentIndex: index, delta, partial: this.message });
  }

  closeBlock(): void {
    const open = this.open;
    if (!open) return;
    this.open = undefined;
    const block = this.message.content[open.index];
    if (block?.type === 'text') this.stream.push({ type: 'text_end', contentIndex: open.index, content: block.text, partial: this.message });
    if (block?.type === 'thinking') this.stream.push({ type: 'thinking_end', contentIndex: open.index, content: block.thinking, partial: this.message });
  }

  toolUse(calls: PiToolCall[]): void {
    this.closeBlock();
    for (const call of calls) {
      const block: ToolCall = { type: 'toolCall', id: call.id, name: call.name, arguments: call.arguments };
      this.message.content.push(block);
      const contentIndex = this.message.content.length - 1;
      this.stream.push({ type: 'toolcall_start', contentIndex, partial: this.message });
      this.stream.push({ type: 'toolcall_delta', contentIndex, delta: JSON.stringify(call.arguments), partial: this.message });
      this.stream.push({ type: 'toolcall_end', contentIndex, toolCall: block, partial: this.message });
    }
    this.finish('toolUse');
  }

  finish(reason: 'stop' | 'toolUse'): void {
    if (this.ended) return;
    this.closeBlock();
    this.ended = true;
    this.message.stopReason = reason;
    this.stream.push({ type: 'done', reason, message: this.message });
    this.stream.end();
  }

  fail(errorMessage: string, aborted: boolean): void {
    if (this.ended) return;
    this.closeBlock();
    this.ended = true;
    this.message.stopReason = aborted ? 'aborted' : 'error';
    this.message.errorMessage = errorMessage;
    this.stream.push({ type: 'error', reason: this.message.stopReason, error: this.message });
    this.stream.end();
  }

  private openBlock(kind: 'text' | 'thinking'): number {
    if (this.open?.kind === kind) return this.open.index;
    this.closeBlock();
    this.message.content.push(kind === 'text' ? { type: 'text', text: '' } : { type: 'thinking', thinking: '' });
    const index = this.message.content.length - 1;
    this.open = { kind, index };
    this.stream.push({ type: kind === 'text' ? 'text_start' : 'thinking_start', contentIndex: index, partial: this.message });
    return index;
  }
}
