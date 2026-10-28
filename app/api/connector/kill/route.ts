import { connectorContext, connectorJson } from "@/lib/connectors/http";
import { setKillSwitch } from "@/lib/services/kill-switch";
export const runtime = "nodejs";
/** The extension's Stop button. Only stopping is possible from here; starting again is done in the web app. */
export async function POST(request: Request) {
  const context = connectorContext(request);
  if (context instanceof Response) return context;
  setKillSwitch(context.db, true, `device:${context.device.id}`);
  return connectorJson({ stopped: true });
}
