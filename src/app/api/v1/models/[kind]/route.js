import { buildModelsList } from "@/sse/services/allowedModels.js";
import { isValidApiKey, extractApiKey, isProviderAllowed, isComboAllowed, isKindAllowed } from "@/sse/services/auth.js";
import { stripComboPrefix } from "open-sse/services/combo.js";

import { getSettings } from "@/lib/localDb";

const KIND_SLUG_MAP = {
  "image": ["image"],
  "tts": ["tts"],
  "stt": ["stt"],
  "embedding": ["embedding"],
  "image-to-text": ["imageToText"],
  "web": ["webSearch", "webFetch"],
};

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export async function GET(request, { params }) {
  try {
    const { kind } = await params;
    const kindFilter = KIND_SLUG_MAP[kind];

    if (!kindFilter) {
      return Response.json(
        {
          error: {
            message: `Unknown model kind: ${kind}. Supported: ${Object.keys(KIND_SLUG_MAP).join(", ")}`,
            type: "invalid_request_error",
          },
        },
        { status: 404, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const settings = await getSettings();
    let apiKeyInfo = null;

    if (settings.requireApiKey) {
      const apiKey = extractApiKey(request);
      if (!apiKey) {
        return Response.json(
          { error: { message: "Missing API key", type: "authentication_error" } },
          { status: 401, headers: { "Access-Control-Allow-Origin": "*" } }
        );
      }
      apiKeyInfo = await isValidApiKey(apiKey);
      if (!apiKeyInfo) {
        return Response.json(
          { error: { message: "Invalid API key", type: "authentication_error" } },
          { status: 401, headers: { "Access-Control-Allow-Origin": "*" } }
        );
      }
    }

    if (apiKeyInfo && !kindFilter.some(k => isKindAllowed(apiKeyInfo, k))) {
      return Response.json({ object: "list", data: [] }, { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    let data = await buildModelsList(kindFilter);

    if (apiKeyInfo) {
      const allowedOwners = new Map();
      for (const model of data) {
        const isCombo = model.owned_by === "combo";
        const key = isCombo
          ? `combo:${stripComboPrefix(model.id)}`
          : `provider:${model.id.includes("/") ? model.id.split("/")[0] : model.owned_by}`;
        if (!allowedOwners.has(key)) {
          const allowed = isCombo
            ? isComboAllowed(apiKeyInfo, key.slice(6))
            : await isProviderAllowed(apiKeyInfo, key.slice(9));
          allowedOwners.set(key, allowed);
        }
      }
      data = data.filter((model) => {
        const isCombo = model.owned_by === "combo";
        const key = isCombo
          ? `combo:${stripComboPrefix(model.id)}`
          : `provider:${model.id.includes("/") ? model.id.split("/")[0] : model.owned_by}`;
        return allowedOwners.get(key);
      });
    }


    return Response.json({ object: "list", data }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (error) {
    console.log("Error fetching models by kind:", error);
    return Response.json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500 }
    );
  }
}
