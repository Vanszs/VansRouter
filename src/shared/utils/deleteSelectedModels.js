// Use the existing authenticated, provider-scoped deletion endpoints. Stop on
// failure instead of reporting a successful batch after a partial deletion.
export async function deleteSelectedModels(models, providerAlias, aliases = {}, fetchFn = fetch) {
  const unique = new Map(models.map((m) => [`${m.id}|${m.type || "llm"}`, m]));
  for (const model of unique.values()) {
    if (model.source === "custom") {
      const params = new URLSearchParams({ providerAlias, id: model.id, type: model.type || "llm" });
      const res = await fetchFn(`/api/models/custom?${params}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed to remove ${model.id}; some earlier models may already have been removed.`);
    }
    const fullModel = `${providerAlias}/${model.id}`;
    for (const [alias, target] of Object.entries(aliases)) {
      if (target !== fullModel) continue;
      const res = await fetchFn(`/api/models/alias?${new URLSearchParams({ alias })}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed to remove alias ${alias}; some earlier entries may already have been removed.`);
    }
  }
}
