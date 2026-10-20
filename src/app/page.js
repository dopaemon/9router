import { redirect } from "next/navigation";
import { isSetupComplete } from "@/lib/db/setupStatus";

export default function InitPage() {
  if (!isSetupComplete()) {
    redirect("/setup");
  }
  redirect("/dashboard");
}
