/** Preserve exact audit evidence without making internal codes the primary interface. */
export function ActivityDetail({ action, detail }: { action: string; detail?: string | null }) {
  return <details className="support-detail"><summary>Details for support</summary><p className="mt-2 break-words">{action}{detail ? ` · ${detail}` : ""}</p></details>;
}
