/** Opt-in real LOCAL inference with made-up profiles only: writes five first messages and five comments for the owner to read.
 * No Instagram, no paid API, nothing is sent. Run: LOCAL_AI_MODEL=<installed model> npx tsx scripts/local-writing-samples.ts */
import { mkdirSync, writeFileSync } from "node:fs";
import { LocalEngine } from "@/lib/engine/local";
import { openDb } from "@/lib/db/core";
import { draftWarmupComment } from "@/lib/services/comment-writing";
import { draftFirstDm } from "@/lib/services/drafting";

const PROFILES = [
  { handle: "annas.credit.path", followers: 14200, niche: "credit repair coaching", notes: "Bio: 'Helping families fix their credit and buy their first home'. Link in bio goes to a bare Linktree with one 'Book a call' button. Latest post: a story about a client who was denied a mortgage twice and finally got approved. Posts three times a week. No prices shown." },
  { handle: "coach.marcus.fit", followers: 31800, niche: "online fitness coaching", notes: "Bio: '12-week body reset program, next cohort opens soon'. Link goes to a page with a long form and no thank-you step. Latest post: a reel of a client's before and after with a caption about discipline. Runs Meta ads (seen in the ad library)." },
  { handle: "nurse.next.chapter", followers: 6900, niche: "career coaching for nurses", notes: "Bio: 'Leave the bedside, keep your purpose'. Link in bio is a Calendly page. Latest post: a carousel about writing a resume after ten years in one hospital. Replies to every comment in a warm, funny tone." },
  { handle: "kitchentable.cmo", followers: 52000, niche: "mindset and productivity for mothers", notes: "Bio: 'Mom of 3. Building a calm business at kitchen-table speed'. Sells a $97 planner and a $750 group program (prices visible on her page). Latest post: a candid reel about burnout and asking for help." },
  { handle: "money.lessons.liv", followers: 3400, niche: "personal finance education", notes: "Bio: 'Money lessons I wish school taught'. No link in bio. Latest post: a plain-text carousel on why a budget fails by week three. Small but very engaged audience; comments are long and personal." },
];

async function main() {
  const engine = new LocalEngine(), db = openDb(":memory:");
  const out: { handle: string; comment: string; parts: string[] }[] = [];
  try {
    await engine.assertReady();
    db.exec(`INSERT INTO ig_accounts(id,handle,profile_dir,ramp_start) VALUES(1,'sender.account','unused','2020-01-01');
      INSERT INTO campaigns(id,name,status,approval_required) VALUES(1,'Samples','active',1);
      INSERT INTO campaign_accounts(campaign_id,account_id) VALUES(1,1);`);
    for (const [index, p] of PROFILES.entries()) {
      db.prepare("INSERT INTO leads(id,handle,campaign_id,account_id,stage,followers,niche) VALUES(?,?,1,1,'warmed',?,?)").run(index + 1, p.handle, p.followers, p.niche);
      // When the writer cannot produce a comment that follows the rules, the real warm-up just likes that post; show the same here.
      const comment = await draftWarmupComment(engine, p.notes).catch((error: unknown) => (error instanceof Error && /^Comment writing did not return valid text/.test(error.message) ? "(no comment: the writer broke the rules three times, so the app would only like this post)" : Promise.reject(error)));
      const message = await draftFirstDm(db, engine, index + 1, p.notes, "samples");
      out.push({ handle: p.handle, comment, parts: message.parts });
      if (message.approvalReasons.some((r) => r.startsWith("Reviewer concern"))) console.log(`  (held for a person: ${message.approvalReasons.find((r) => r.startsWith("Reviewer concern"))})`);
      console.log(`\n@${p.handle} (${p.niche})\n  comment: ${comment}\n  first message:\n${message.parts.map((part) => `    | ${part}`).join("\n")}`);
      // Sending is simulated: mark this one sent so the next draft is checked against it, like the real variety check.
      db.prepare("UPDATE messages SET status='sent', sent_at=datetime('now') WHERE id=?").run(message.id);
    }
    mkdirSync("data", { recursive: true });
    writeFileSync("data/local-writing-samples.json", JSON.stringify({ madeAt: new Date().toISOString(), model: process.env.LOCAL_AI_MODEL, madeUpProfilesOnly: true, paidCalls: 0, sends: 0, samples: out }, null, 2));
  } finally { db.close(); }
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : "Sample writing failed."); process.exitCode = 1; });
