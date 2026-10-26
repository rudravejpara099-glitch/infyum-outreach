import { connectorBody, connectorContext, connectorJson } from "@/lib/connectors/http";
import { completeDeviceCommand, getDeviceCommand } from "@/lib/connectors/commands";
import { setAccountStatus } from "@/lib/db/repos/accounts";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const context = connectorContext(request);
  if (context instanceof Response) return context;
  try {
    const body = await connectorBody(request), { db, device } = context;
    if (typeof body.id !== "string" || (body.error !== undefined && typeof body.error !== "string")) return connectorJson({ error: "Invalid task result." }, 400);
    const command = getDeviceCommand(db, body.id);
    if (!command || command.deviceId !== device.id) return connectorJson({ error: "Task not found." }, 404);
    const accepted = completeDeviceCommand(db, device.id, body.id, body.result ?? null, body.error as string | undefined);
    if (accepted && body.blockedByInstagram === true) setAccountStatus(db, command.accountId, "blocked", "Instagram showed a warning or human check. Review it in your Chrome.", "device");
    return connectorJson({ accepted }, accepted ? 200 : 409);
  } catch { return connectorJson({ error: "The device result could not be saved. Review Instagram before retrying an action." }, 400); }
}
