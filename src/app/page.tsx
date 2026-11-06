import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SITE_URL } from "@/lib/site";

/** The app has no home page of its own: signed-in people go to their dashboard, everyone else to the main site. */
export default async function Home() {
  const session = await auth().catch(() => null);
  redirect(session?.user ? "/dashboard" : SITE_URL);
}
