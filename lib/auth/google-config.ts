import "server-only";
import { config } from "@/lib/config";
import { getIdentityDb } from "@/lib/workspaces/storage";
import { getSetting } from "@/lib/db/repos/settings";

export const googleEnabled = (): boolean => Boolean(config.google.clientId && config.google.clientSecret);
/** The address Google sends people back to must be exactly the one registered in Google Cloud, so prefer the configured public address. */
export const appOrigin = (request: Request): string => (config.google.appUrl || new URL(request.url).origin).replace(/\/$/, "");
export const redirectUri = (origin: string): string => `${origin}/api/auth/google/callback`;
export const sessionKey = (): Uint8Array => new TextEncoder().encode(config.sessionSecret);
export const passwordSignInOff = (): boolean => googleEnabled() && getSetting(getIdentityDb(), "password_sign_in_off") === "1";

export const GOOGLE_MESSAGES: Record<string, string> = {
  off: "Google sign-in is not set up on this server.",
  denied: "Google sign-in was cancelled.",
  expired: "That sign-in took too long or was not started here. Please try again.",
  failed: "Google could not confirm who you are. Please try again.",
  not_linked: "This Google account is not connected to a team account. Sign in with your email and password once, then use Connect Google in Settings.",
  no_workspace: "This account no longer belongs to a workspace. Ask the owner for a new invitation.",
  taken: "That Google account is already connected to someone else.",
  already_linked: "Your account already has a different Google account connected. Disconnect it first.",
  linked: "Google is connected. You can now sign in with it.",
};
