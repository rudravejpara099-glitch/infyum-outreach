import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { listAccounts } from "@/lib/db/repos/accounts";
import { CampaignForm } from "@/components/campaign-form";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewCampaign() {
  await requireUser();
  return (
    <>
      <PageHeader title="New campaign" sub="Say who you want to reach and how." />
      <CampaignForm accounts={listAccounts((await getDb()))} selected={[]} />
    </>
  );
}
