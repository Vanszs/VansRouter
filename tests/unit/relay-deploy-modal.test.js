import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The proxy-pools page renders four RelayDeployModal instances; only the Deno
// and Netlify ones pass `tokenSteps`. Rendering with the shared UI kit is
// unnecessary here — the modal's own markup is what the omitted prop used to
// crash on, so the children pass straight through.
vi.mock("@/shared/components/Modal", () => ({
  default: ({ children }) => React.createElement("div", null, children),
}));
vi.mock("@/shared/components/Button", () => ({
  default: ({ children }) => React.createElement("button", null, children),
}));
vi.mock("@/shared/components/Input", () => ({
  default: ({ label }) => React.createElement("input", { "aria-label": label }),
}));

const { default: RelayDeployModal } = await import(
  "@/app/(dashboard)/dashboard/proxy-pools/RelayDeployModal.js"
);

function baseProps(overrides = {}) {
  return {
    isOpen: true,
    onClose: () => {},
    title: "Deploy Vercel Relay",
    intro: "Deploys an edge relay function to Vercel.",
    bullets: ["Edge network", "Free tier"],
    fields: [
      { label: "Vercel API Token", value: "", onChange: () => {}, placeholder: "token", hint: "hint", type: "password" },
    ],
    deployLabel: "Deploy",
    onDeploy: () => {},
    deploying: false,
    deployDisabled: true,
    accent: "blue",
    ...overrides,
  };
}

describe("RelayDeployModal", () => {
  it("renders when tokenSteps is omitted (Vercel/Cloudflare call sites)", () => {
    expect(() => renderToStaticMarkup(React.createElement(RelayDeployModal, baseProps()))).not.toThrow();
  });

  it("renders the token steps section when tokenSteps is provided (Deno/Netlify call sites)", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        RelayDeployModal,
        baseProps({ tokenSteps: ["Create a token", "Paste it here"], tokenStepsTitle: "How to generate API token:" })
      )
    );
    expect(html).toContain("How to generate API token:");
    expect(html).toContain("Create a token");
  });

  it("omits the token steps section for an empty tokenSteps array", () => {
    const html = renderToStaticMarkup(
      React.createElement(RelayDeployModal, baseProps({ tokenSteps: [], tokenStepsTitle: "How to generate API token:" }))
    );
    expect(html).not.toContain("How to generate API token:");
  });
});
