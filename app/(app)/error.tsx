"use client";

export default function WorkspaceError({ retry }: { error: unknown; retry: () => void }) {
  return <section className="card p-6" role="alert"><h2>This view couldn’t load</h2><p className="my-3 text-muted">Try loading it again. If it keeps failing, check that the local app and database are available.</p><button type="button" onClick={retry} className="btn">Try again</button></section>;
}
