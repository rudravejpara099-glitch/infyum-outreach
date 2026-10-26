import "server-only";
import { headers } from "next/headers";
import { isThisComputerRequest } from "@/lib/domain/request-origin";

/** True only when the browser runs on the computer that hosts the app (not via a tunnel or proxy). */
export async function requestIsFromThisComputer(): Promise<boolean> {
  const h = await headers();
  return isThisComputerRequest({ host: h.get("host"), forwardedFor: h.get("x-forwarded-for"), forwardedHost: h.get("x-forwarded-host"), cfConnectingIp: h.get("cf-connecting-ip") });
}
