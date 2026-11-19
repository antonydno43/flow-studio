import { handler, ok } from "@/lib/api";
import { TEMPLATES } from "@/core/templates";

export const GET = handler(async () => {
  return ok({
    templates: TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      icon: t.icon,
      requiredProviders: t.requiredProviders,
      nodeCount: t.template.nodes.length,
    })),
  });
});
