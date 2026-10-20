import { redirect } from "next/navigation";
import { isSetupComplete } from "@/lib/db/setupStatus";
import { getMachineId } from "@/shared/utils/machine";
import EndpointPageClient from "./endpoint/EndpointPageClient";

export default async function DashboardPage() {
  if (!isSetupComplete()) {
    redirect("/setup");
  }
  const machineId = await getMachineId();
  return <EndpointPageClient machineId={machineId} />;
}
