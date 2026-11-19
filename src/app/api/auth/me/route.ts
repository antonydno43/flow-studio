import { handler, ok } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";

export const GET = handler(async () => {
  const user = await getSessionUser();
  if (!user) return ok({ authenticated: false, user: null });
  return ok({ authenticated: true, user });
});
