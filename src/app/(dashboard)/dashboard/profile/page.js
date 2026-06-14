import { getSettings } from "@/lib/localDb";
import ProfileClient from "./ProfileClient";

export default async function ProfilePage() {
  let initialSettings = null;
  try {
    initialSettings = await getSettings();
  } catch {}
  return <ProfileClient initialSettings={initialSettings} />;
}
