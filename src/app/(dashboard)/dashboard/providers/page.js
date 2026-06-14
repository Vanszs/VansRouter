import { getProviderConnections, getProviderNodes } from "@/lib/localDb";
import ProvidersClient from "./ProvidersClient";

export default async function ProvidersPage() {
  let initialConnections = [];
  let initialNodes = [];
  try {
    initialConnections = await getProviderConnections();
    initialNodes = await getProviderNodes();
  } catch {}
  return <ProvidersClient initialConnections={initialConnections} initialNodes={initialNodes} />;
}
