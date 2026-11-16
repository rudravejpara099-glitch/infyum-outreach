// Response headers sent with every page and route. Kept separate from next.config.ts so a test can read them.
//
// What this stops: another site putting this app in a frame to trick a click (clickjacking), browsers guessing
// file types, referrer leaks to other sites, and pages asking for the camera, microphone or location.
// What it does NOT do: a full Content-Security-Policy for scripts. That needs per-request nonces because Next.js
// and app/layout.tsx use inline scripts; add it as its own change.
export type Header = { key: string; value: string };

export function securityHeaders(production: boolean): Header[] {
  const headers: Header[] = [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
  // Only over HTTPS in production. Browsers ignore it on http, and a quick tunnel address changes, so no subdomains.
  if (production) headers.push({ key: "Strict-Transport-Security", value: "max-age=15552000" });
  return headers;
}
