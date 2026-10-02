export type RefusalCode = 'subagent_depth_cap';

export type Refusal = Readonly<{ code: RefusalCode; message: string }>;
