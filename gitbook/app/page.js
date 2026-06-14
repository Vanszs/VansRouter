import { DEFAULT_LANG } from "@/constants/languages";
import { redirect } from "next/navigation";

// Server-side redirect to default language
export default function HomePage() {
  redirect(`/${DEFAULT_LANG}/`);
}
