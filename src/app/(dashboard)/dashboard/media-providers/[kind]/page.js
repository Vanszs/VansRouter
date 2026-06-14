import { getProviderConnections, getProviderNodes, getCombos } from "@/lib/localDb";
import MediaKindClient from "./MediaKindClient";

export default async function MediaProviderKindPage() {
  let initialConnections = [];
  let initialNodes = [];
  let initialCombos = [];
  try {
    const [connections, nodes, combos] = await Promise.all([
      getProviderConnections(),
      getProviderNodes(),
      getCombos(),
    ]);
    initialConnections = connections;
    initialNodes = (nodes || []).filter((n) => n.type === "custom-embedding");
    initialCombos = combos;
  } catch {}
  return <MediaKindClient initialConnections={initialConnections} initialNodes={initialNodes} initialCombos={initialCombos} />;
}
