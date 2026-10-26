/**
 * Controls that start processes or open windows on the host computer must only work for a person
 * sitting at it. Requests arriving through a public tunnel or proxy carry its hostname or forwarding headers.
 */
export function isThisComputerRequest(h: { host: string | null; forwardedFor?: string | null; forwardedHost?: string | null; cfConnectingIp?: string | null }): boolean {
  const loopback = (value: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(value.trim());
  if (!h.host || !loopback(h.host)) return false;
  if (h.cfConnectingIp) return false;
  if (h.forwardedHost && !loopback(h.forwardedHost)) return false;
  if (h.forwardedFor && h.forwardedFor.split(",").some((ip) => !/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ip.trim()))) return false;
  return true;
}
