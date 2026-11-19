import { handler, ok } from "@/lib/api";
import { getCatalog } from "@/core/nodes/registry";

/** Client-safe node catalog (definitions without execute logic). */
export const GET = handler(async () => {
  return ok({ nodes: getCatalog() });
});
