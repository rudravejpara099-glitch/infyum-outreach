"use client";
import { approveSelected } from "@/app/(app)/approvals/actions";
import { ActionForm } from "./action-form";
import { useState } from "react";

export function BulkApproval({ empty }: { empty: boolean }) {
  const [completed, setCompleted] = useState("");
  if (empty && !completed) return null;
  if (empty) return <p className="card p-4 text-sm text-muted" role="status">{completed}</p>;
  return <section className="card p-5" aria-labelledby="bulk-title">
    <h2 id="bulk-title" className="font-semibold">Approve selected drafts</h2>
    <p className="mb-3 mt-1 text-sm text-muted">Read each draft and select the ones you’re ready to queue. Drafts flagged for sensitive topics or similar wording need individual review.</p>
    <ActionForm id="bulk-approval" onResult={result => { if (result.message) setCompleted(result.message); }} action={async data => {
      for (const id of data.getAll("selected").map(String)) {
        if (!/^[1-9]\d*$/.test(id)) continue;
        document.querySelectorAll<HTMLTextAreaElement>(`#message-${id} textarea[name="part"]`).forEach(input => data.append(`part-${id}`, input.value));
      }
      return approveSelected(data);
    }}>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="reviewed" required />I’ve reviewed every selected draft</label>
      <button className="btn w-fit">Approve selected and queue</button>
    </ActionForm>
  </section>;
}
