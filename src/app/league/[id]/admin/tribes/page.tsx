import { redirect } from "next/navigation";

/**
 * Tribe management has been folded into the merged "Castaways & Tribes" admin
 * page. Preserve old links by redirecting here.
 */
export default function LegacyAdminTribesPage({ params }: { params: { id: string } }) {
  redirect(`/league/${params.id}/admin/castaways?section=tribes`);
}
