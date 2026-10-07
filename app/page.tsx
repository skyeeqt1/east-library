import { redirect } from "next/navigation";

/**
 * Root route — always sends visitors to the login screen (there is no public
 * landing page; unauthenticated users are bounced here by middleware too, and
 * authenticated users are routed to their role home by middleware).
 */
export default function HomePage() {
  redirect("/login");
}
