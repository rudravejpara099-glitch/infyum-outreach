import { connectorBody, connectorContext, connectorJson, wireCommand } from "@/lib/connectors/http";
import { cancelDeviceCommand, claimDeviceCommand, getDeviceCommand } from "@/lib/connectors/commands";
import { commandMayContinue } from "@/lib/connectors/authorization";
export const runtime = "nodejs";
/** Scoped device credential is checked before opening any company data. */
export async function POST(request: Request) {
  const context = connectorContext(request);
  if (context instanceof Response) return context;
  try {
    const body = await connectorBody(request), { db, device } = context;
    if (body.commandId !== undefined) {
      if (typeof body.commandId !== "string") return connectorJson({ error: "Invalid task." }, 400);
      const command = getDeviceCommand(db, body.commandId);
      if (!command || command.deviceId !== device.id) return connectorJson({ error: "Task not found." }, 404);
      const allowed = commandMayContinue(db, command);
      if (!allowed) cancelDeviceCommand(db, command.id, "This task was stopped or expired. Review any partial Instagram actions.");
      return connectorJson({ continue: allowed, command: wireCommand(db, getDeviceCommand(db, command.id)!) });
    }
    const command = claimDeviceCommand(db, device.id);
    if (!command) return connectorJson({ command: null });
    if (!commandMayContinue(db, command)) {
      cancelDeviceCommand(db, command.id, "The campaign or account is no longer ready.");
      return connectorJson({ command: null });
    }
    return connectorJson({ command: wireCommand(db, command) });
  } catch { return connectorJson({ error: "The device task could not be checked." }, 400); }
}
