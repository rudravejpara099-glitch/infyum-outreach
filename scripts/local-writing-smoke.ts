/** Opt-in real LOCAL inference with synthetic content only. No Instagram or paid API. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { LocalEngine } from "@/lib/engine/local";
import { SYSTEM, followupPrompt } from "@/lib/engine/prompts";
import { checkDraft, parseParts } from "@/lib/engine/validate";
import { warmupCommentError } from "@/lib/domain/warmup-comment";
import { openDb } from "@/lib/db/core";
import { draftWarmupComment } from "@/lib/services/comment-writing";
import { draftFirstDm } from "@/lib/services/drafting";

async function main() {
  const engine = new LocalEngine(), db = openDb(":memory:");
  const notes = "Synthetic fixture: a US credit education business. Its latest post explains a five-step document checklist before requesting a credit report. Its bio links directly to a consultation form. No results or prices are published. The person's name is unknown.";
  const started = Date.now();
  try {
    await engine.assertReady();
    console.log("Installed local model confirmed. Testing synthetic comment and drafts.");
    const comment = await draftWarmupComment(engine, "Synthetic post explaining a five-step document checklist before a credit report request.");
    assert.equal(warmupCommentError(comment), null, "The real local model must obey comment rules");
    db.exec(`INSERT INTO ig_accounts(id,handle,profile_dir,ramp_start) VALUES(1,'synthetic.sender','unused','2020-01-01');
      INSERT INTO campaigns(id,name,status,approval_required) VALUES(1,'Synthetic local writing','active',1);
      INSERT INTO campaign_accounts(campaign_id,account_id) VALUES(1,1);
      INSERT INTO leads(id,handle,campaign_id,account_id,stage) VALUES(1,'synthetic.prospect',1,1,'warmed');`);
    const message = await draftFirstDm(db, engine, 1, notes, "synthetic-smoke");
    assert.equal(message.status, "pending_approval");
    assert.equal(checkDraft(message.parts, "dm"), null);
    for (const name of ["Rudra", "Infyum", "India"]) assert(message.parts[1].includes(name), `The local draft must include the decided sender identity: ${name}`);
    const followup = parseParts(await engine.complete({ system: SYSTEM, format: "followup", prompt: followupPrompt({ handle: "synthetic.prospect", previous: message.parts.join("\n"), number: 1, profileNotes: notes }) }));
    assert.equal(checkDraft(followup, "followup"), null);
    assert.equal((db.prepare("SELECT count(*) n FROM messages WHERE status='sent'").get() as { n: number }).n, 0);
    assert.equal((db.prepare("SELECT count(*) n FROM billing_usage_events").get() as { n: number }).n, 0);
    mkdirSync("data", { recursive: true });
    writeFileSync("data/local-writing-proof.json", JSON.stringify({ verifiedAt: new Date().toISOString(), model: process.env.LOCAL_AI_MODEL, elapsedMs: Date.now() - started, syntheticOnly: true, paidCalls: 0, sends: 0, comment, parts: message.parts, followup }, null, 2));
    console.log(`Local writing smoke passed in ${Math.round((Date.now() - started) / 1000)}s: real comment, three-part draft awaiting approval, follow-up, zero billing and zero sends.`);
  } finally { db.close(); }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Local writing check failed."); process.exitCode = 1; });
