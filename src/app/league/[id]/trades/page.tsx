import { redirect } from "next/navigation";

/**
 * The standalone Trades page has been folded into the "Moves" page.
 * Trades now live at /league/[id]/waiver?section=trades. Preserve old links
 * by redirecting here.
 */
export default function LegacyTradesPage({ params }: { params: { id: string } }) {
  redirect(`/league/${params.id}/waiver?section=trades`);
}
