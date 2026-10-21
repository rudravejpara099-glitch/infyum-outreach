import type { CampaignDay } from "@/lib/queries/campaign-history";

export function CampaignHistory({ days, timeZone }: { days: CampaignDay[]; timeZone: string }) {
  const sent = days.reduce((sum, day) => sum + day.sent, 0);
  const replies = days.reduce((sum, day) => sum + day.replies, 0);
  const max = Math.max(1, ...days.flatMap(day => [day.sent, day.replies]));
  const label = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  return <section className="campaign-history" aria-labelledby="history-title">
    <h3 id="history-title">Last 14 days</h3>
    <p className="help-text">{sent} {sent === 1 ? "message" : "messages"} sent · {replies} first {replies === 1 ? "reply" : "replies"}. Dates use {timeZone.replaceAll("_", " ")}.</p>
    {!sent && !replies ? <p className="text-muted">No sends or first replies recorded in this period. Activity will appear after outreach begins.</p> : <>
      <div className="history-legend"><span><i className="history-sent" />Messages sent</span><span><i className="history-replies" />First replies</span></div>
      <div className="history-bars" role="img" aria-label={`Daily activity over the last 14 days: ${sent} messages sent and ${replies} first replies. Exact daily counts are in the table below.`}>
        {days.map((day, index) => <div key={day.date} className="history-day" title={`${label(day.date)}: ${day.sent} sent, ${day.replies} first replies`}>
          <div className="history-pair"><i className="history-sent" style={{ height: `${day.sent / max * 100}%` }} /><i className="history-replies" style={{ height: `${day.replies / max * 100}%` }} /></div>
          <small>{(index % 4 === 0 && index < days.length - 2) || index === days.length - 1 ? label(day.date) : ""}</small>
        </div>)}
      </div>
    </>}
    <details className="mt-4"><summary className="text-link">Daily counts</summary><div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Daily campaign activity in {timeZone}</caption><thead><tr><th scope="col">Date</th><th scope="col">Messages sent</th><th scope="col">First replies</th></tr></thead><tbody>{days.map(day => <tr key={day.date}><th scope="row">{label(day.date)}</th><td>{day.sent}</td><td>{day.replies}</td></tr>)}</tbody></table></div></details>
    <p className="help-text">A three-part first contact counts as one send; each follow-up counts as one more. First replies count each lead once when the app records a real reply. Earlier imported conversations may have no recorded hand-off date.</p>
  </section>;
}
