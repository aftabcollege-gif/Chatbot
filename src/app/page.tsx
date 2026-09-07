import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The application lives under the authenticated (main) layout; the middleware
// sends anonymous visitors to /login and back to /chat afterwards.
export default function HomePage() {
  redirect("/chat");
}
