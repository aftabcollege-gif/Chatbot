import { redirect } from "next/navigation";

// Legacy route — the documents UI lives at /documents (sidebar item «اسناد»).
export default function ResourcesPage() {
  redirect("/documents");
}
