import { type DashboardView, renderMagazinePage } from "../portal/html.ts";
import type { CatalogCardView, ResolvedPage } from "./types.ts";

export function renderComposedPage(view: DashboardView, page: ResolvedPage): string {
  const picks = page.components.flatMap((item) => {
    if (item.kind !== "catalog_card") return [];
    const card = item as CatalogCardView;
    return [{
      id: card.id,
      name: card.name,
      description: card.description,
      governanceState: card.governanceState,
      channels: [...card.channels],
      version: card.version,
    }];
  });
  return renderMagazinePage({
    theme: "system",
    channel: null,
    view,
    picks,
  });
}
