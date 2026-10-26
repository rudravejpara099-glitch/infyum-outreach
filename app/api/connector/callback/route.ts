import { connectorBody, connectorContext, connectorJson } from "@/lib/connectors/http";
import { getDeviceCommand, requestDeviceCallback } from "@/lib/connectors/commands";
import { commandMayContinue } from "@/lib/connectors/authorization";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const context = connectorContext(request);
  if (context instanceof Response) return context;
  try {
    const body = await connectorBody(request), { db, device } = context;
    if (typeof body.id !== "string" || typeof body.callbackId !== "string" || typeof body.context !== "string") return connectorJson({ error: "Invalid writing request." }, 400);
    const command = getDeviceCommand(db, body.id);
    if (!command || command.deviceId !== device.id || !commandMayContinue(db, command)) return connectorJson({ error: "Task not found or stopped." }, 409);
    const accepted = requestDeviceCallback(db, device.id, body.id, body.callbackId, body.context);
    return connectorJson({ accepted }, accepted ? 202 : 409);
  } catch { return connectorJson({ error: "The writing request could not be checked." }, 400); }
}
