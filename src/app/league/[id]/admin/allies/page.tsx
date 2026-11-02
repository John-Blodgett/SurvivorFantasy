import { redirect } from "next/navigation";

/**
 * Alliance management has been folded into the merged "Castaways & Tribes"
 * admin page. Preserve old links by redirecting here.
 */
export default function LegacyAdminAlliesPage({ params }: { params: { id: string } }) {
  redirect(`/league/${params.id}/admin/castaways?section=alliances`);
}
