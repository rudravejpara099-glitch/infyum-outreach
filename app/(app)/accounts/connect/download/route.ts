import { requireUser } from "@/lib/auth/dal";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
export const runtime = "nodejs";
export async function GET() {
  await requireUser();
  const name = `Outreach-Connector-macOS-${process.arch}.zip`, file = path.join(process.cwd(), "data", "connector-dist", name);
  if (!existsSync(file)) return new Response("The connector download is not available yet.", { status: 404 });
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>, { headers: { "content-type": "application/zip", "content-length": String(statSync(file).size), "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" } });
}
