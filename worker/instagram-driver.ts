import type { IgAccount } from "@/lib/db/types";
import type { InstagramDriver, ProfileFacts, WarmUpResult } from "./driver";
import { ChromeReadOnlyInstagram } from "./chrome-read-only";
import { PlaywrightInstagram } from "./instagram";

/** Selects the explicitly chosen browser connection per account. */
export class AccountInstagramDriver implements InstagramDriver {
  private readonly isolated = new PlaywrightInstagram();
  private readonly chrome = new Map<number, ChromeReadOnlyInstagram>();
  private for(account: IgAccount): InstagramDriver {
    if (account.browserMode !== "chrome_read_only") return this.isolated;
    let driver = this.chrome.get(account.id);
    if (!driver) { driver = new ChromeReadOnlyInstagram(); this.chrome.set(account.id, driver); }
    return driver;
  }
  openLogin(account: IgAccount) { return this.for(account).openLogin(account); }
  readFacts(account: IgAccount, handle: string): Promise<ProfileFacts> { return this.for(account).readFacts(account, handle); }
  readProfileNotes(account: IgAccount, handle: string) { return this.for(account).readProfileNotes(account, handle); }
  warmUp(account: IgAccount, handle: string, pieces: number, makeComment: (context: string) => Promise<string>): Promise<WarmUpResult> { return this.for(account).warmUp(account, handle, pieces, makeComment); }
  sendMessages(account: IgAccount, handle: string, parts: string[]) { return this.for(account).sendMessages(account, handle, parts); }
  readInbox(account: IgAccount) { return this.for(account).readInbox(account); }
  async close() {
    await Promise.allSettled([
      this.isolated.close(),
      ...[...this.chrome.values()].map((driver) => driver.close()),
    ]);
    this.chrome.clear();
  }
}
