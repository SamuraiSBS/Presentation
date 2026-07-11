import { ProfileView } from "@/components/profile/profile-view";
import type { ProfileSummary } from "@/lib/account-types";
import { internalFetch } from "@/lib/internal-api";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const profile = await internalFetch<ProfileSummary>("/users/me");
  return <ProfileView initialProfile={profile} />;
}
