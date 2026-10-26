export class BillingError extends Error {}
export function publicBillingError(error: unknown): string {
  return error instanceof BillingError ? error.message : "This change couldn’t be completed. Check the billing connection or ask the workspace owner, then try again.";
}
