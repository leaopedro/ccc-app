export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export type PushSendOutcome =
  | { kind: 'ok' }
  | { kind: 'invalid-token' }
  | { kind: 'error'; message: string };

export type PushSendResult = {
  outcomesByToken: Map<string, PushSendOutcome>;
};

export interface PushSender {
  send(messages: PushMessage[]): Promise<PushSendResult>;
}
