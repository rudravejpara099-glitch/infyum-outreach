import { expect, it, vi } from "vitest";
vi.mock("@/lib/auth/dal", () => ({ requireUser: vi.fn(async () => ({ id: 1, workspaceId: "private-company", hostChromeAllowed: false })) }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/billing/provider", () => ({ testStripe: vi.fn() }));
import { testStripe } from "@/lib/billing/provider";
import { getDb } from "@/lib/db";
import { payStatement, refreshPaymentFees } from "@/app/(app)/billing/actions";

it("does not use the host's payment credentials for a private company", async () => {
  expect((await payStatement(new FormData())).error).toContain("not connected for this workspace");
  expect((await refreshPaymentFees(new FormData())).error).toContain("not connected for this workspace");
  expect(testStripe).not.toHaveBeenCalled();
  expect(getDb).not.toHaveBeenCalled();
});
