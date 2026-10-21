import type { IgAccount } from "@/lib/db/types";

/** Instagram showed a warning, a human check or a block. The worker stops that account immediately. */
export class InstagramBlockedError extends Error {}

/** Sending began, so a retry could duplicate a message that Instagram already received. */
export class InstagramSendUncertainError extends Error {
  constructor(readonly blockedByInstagram = false) {
    super("A message may have been sent. Check the Instagram conversation before trying again.");
  }
}

export type ProfileFacts = { isPublic: boolean; country: string | null; followers: number; linkedToInfyum: boolean };
export type WarmUpResult = { likes: number; comments: number; followed: boolean };

/** Everything the app needs from Instagram. The real one drives a browser; tests use a fake. */
export interface InstagramDriver {
  openLogin(account: IgAccount): Promise<void>;
  readFacts(account: IgAccount, handle: string): Promise<ProfileFacts>;
  readProfileNotes(account: IgAccount, handle: string): Promise<string>;
  warmUp(account: IgAccount, handle: string, pieces: number, makeComment: (context: string) => Promise<string>): Promise<WarmUpResult>;
  sendMessages(account: IgAccount, handle: string, parts: string[]): Promise<void>;
  /** New messages from other people since the last read. */
  readInbox(account: IgAccount): Promise<{ handle: string; text: string }[]>;
}
