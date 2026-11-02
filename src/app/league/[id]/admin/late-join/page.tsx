import { redirect } from "next/navigation";

/**
 * Late-Join assignment has been folded into the merged Draft admin page.
 * Preserve old links by redirecting here.
 */
export default function LegacyAdminLateJoinPage({ params }: { params: { id: string } }) {
  redirect(`/league/${params.id}/admin/draft?section=late-join`);
}
