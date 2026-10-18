export async function importSelectedModels(models, fetchFn = fetch) {
  if (!models.length) return 0;
  const res = await fetchFn("/api/models/custom", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ models }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to import models");
  return data.count ?? models.length;
}
