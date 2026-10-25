"use client";

import PropTypes from "prop-types";
import Modal from "@/shared/components/Modal";
import Button from "@/shared/components/Button";
import Input from "@/shared/components/Input";

// One modal for every "deploy a relay to an edge provider" flow (Vercel,
// Cloudflare, Deno, Netlify). The provider-specific parts — the explainer,
// the token steps, the fields and the deploy call — come in as props; only
// the shape is shared.
export default function RelayDeployModal({
  isOpen,
  onClose,
  title,
  intro,
  bullets,
  tokenSteps,
  tokenStepsTitle,
  fields,
  deployLabel,
  onDeploy,
  deploying,
  deployDisabled,
  accent,
}) {
  const accents = {
    blue: "bg-blue-500/5 border border-blue-500/10",
    teal: "bg-teal-500/5 border border-teal-500/10",
    neutral: "bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10",
  };
  const dividers = {
    blue: "border-t border-blue-500/10",
    teal: "border-t border-teal-500/10",
    neutral: "border-t border-black/10 dark:border-white/10",
  };
  const accentClass = accents[accent] || accents.neutral;
  const accentDivider = dividers[accent] || dividers.neutral;

  return (
    <Modal isOpen={isOpen} title={title} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className={`rounded-lg p-3 flex flex-col gap-1.5 ${accentClass}`}>
          <p className="text-sm text-text-main font-medium">What is {title.replace(/^Deploy /, "")}?</p>
          <p className="text-xs text-text-muted">{intro}</p>
          <ul className="text-xs text-text-muted list-disc pl-4 space-y-0.5">
            {bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
          {tokenSteps.length > 0 && (
            <div className={`mt-2 pt-2 text-xs text-text-muted ${accentDivider}`}>
              <p className="font-medium text-text-main mb-1">{tokenStepsTitle}</p>
              <ol className="list-decimal pl-4 space-y-0.5">
                {tokenSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
        {fields.map((field) => (
          <Input
            key={field.label}
            label={field.label}
            value={field.value}
            onChange={field.onChange}
            placeholder={field.placeholder}
            hint={field.hint}
            type={field.type}
          />
        ))}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button fullWidth onClick={onDeploy} disabled={deployDisabled || deploying}>
            {deploying ? "Deploying... (may take ~1 min)" : deployLabel}
          </Button>
          <Button fullWidth variant="ghost" onClick={onClose} disabled={deploying}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

RelayDeployModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  title: PropTypes.string.isRequired,
  intro: PropTypes.string.isRequired,
  bullets: PropTypes.arrayOf(PropTypes.string).isRequired,
  tokenSteps: PropTypes.arrayOf(PropTypes.string),
  tokenStepsTitle: PropTypes.string,
  fields: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      value: PropTypes.string.isRequired,
      onChange: PropTypes.func.isRequired,
      placeholder: PropTypes.string,
      hint: PropTypes.node,
      type: PropTypes.string,
    })
  ).isRequired,
  deployLabel: PropTypes.string.isRequired,
  onDeploy: PropTypes.func.isRequired,
  deploying: PropTypes.bool,
  deployDisabled: PropTypes.bool,
  accent: PropTypes.string,
};
