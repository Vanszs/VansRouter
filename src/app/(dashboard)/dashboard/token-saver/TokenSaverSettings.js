"use client";

import { Card, Toggle } from "@/shared/components";

export default function TokenSaverSettings({
  rtkEnabled,
  handleRtkEnabled,
  headroomRunning,
  headroomStatusLabel,
  setShowHeadroomInstallModal,
  headroomEnabled,
  handleHeadroomEnabled,
  headroomStatus,
  headroomExtras,
  pendingExtras,
  codeAware,
  kompress,
  restartingProxy,
  toggleExtraActive,
  handleRemoveExtra,
  removingExtra,
  togglePendingExtra,
  handleInstallExtras,
  extrasActionLoading,
  extrasActionError,
  installLog,
  cavemanEnabled,
  visibleCavemanLevels,
  handleCavemanLevel,
  cavemanLevel,
  cavemanLevels,
  handleCavemanEnabled,
  ponytailEnabled,
  ponytailLevels,
  handlePonytailLevel,
  ponytailLevel,
  handlePonytailEnabled,
  customPromptEnabled,
  customPrompt,
  setCustomPrompt,
  handleCustomPromptEnabled,
  handleCustomPromptBlur,
  pxpipeChipClass,
  pxpipeStatusLabel,
  setShowPxpipeModal,
  pxpipeStatus,
  pxpipeEnabled,
  handlePxpipeEnabled,
}) {
  return (
    <Card id="rtk">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">
            bolt
          </span>
          Token Saver
        </h2>
      </div>
      <div className="flex items-center justify-between pt-2 pb-4 border-b border-border gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            Compress tool output{" "}
            <a
              href="https://github.com/rtk-ai/rtk"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-normal text-primary underline hover:opacity-80"
            >
              (RTK)
            </a>
          </p>
          <p className="text-sm text-text-muted">
            git/grep/ls/tree/logs → 60-90% fewer input tokens
          </p>
        </div>
        <Toggle
          checked={rtkEnabled}
          onChange={() => handleRtkEnabled(!rtkEnabled)}
        />
      </div>
      <div className="flex items-center justify-between py-4 gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <p className="font-medium">
              Compress context{" "}
              <a
                href="https://github.com/chopratejas/headroom"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (Headroom)
              </a>
            </p>
            <span
              className={`text-xs px-2 py-0.5 rounded ${headroomRunning ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}
            >
              {headroomStatusLabel}
            </span>
            <button
              type="button"
              onClick={() => setShowHeadroomInstallModal(true)}
              className="text-xs text-primary underline hover:opacity-80"
            >
              {headroomRunning ? "Manage" : "Setup"}
            </button>
          </div>
          <p className="text-sm text-text-muted mt-1">
            Compress prompts via /v1/compress before routing to the model
          </p>
        </div>
        <Toggle
          checked={headroomEnabled}
          onChange={() => handleHeadroomEnabled(!headroomEnabled)}
        />
      </div>
      {headroomStatus.installed && (
        <div className="mb-3 ml-1 pl-3 pb-4 border-l-2 border-border">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-text-muted">
              Compression extras
              {headroomExtras.version ? ` · v${headroomExtras.version}` : ""}:
            </span>
            {headroomExtras.available.map((extra) => {
              const installed = !!headroomExtras.extras[extra];
              const pending = pendingExtras.includes(extra);
              const extraTitle =
                extra === "code"
                  ? "tree-sitter AST compression for code responses"
                  : "Kompress-v2 HF model for prose/agentic traces (~+1GB)";

              if (installed) {
                const active = extra === "code" ? codeAware : kompress;
                return (
                  <div
                    key={extra}
                    className="flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-success/40 bg-success/5 text-text"
                    title={extraTitle}
                  >
                    <Toggle
                      size="sm"
                      checked={active}
                      disabled={restartingProxy}
                      onChange={() => toggleExtraActive(extra, !active)}
                    />
                    <span className="font-medium">[{extra}]</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveExtra(extra)}
                      disabled={removingExtra === extra}
                      className="ml-1 text-error underline hover:opacity-80 disabled:opacity-50"
                      title={`Uninstall [${extra}]`}
                    >
                      {removingExtra === extra ? "Uninstalling…" : "Uninstall"}
                    </button>
                  </div>
                );
              }

              return (
                <label
                  key={extra}
                  className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded border cursor-pointer transition-colors ${
                    pending
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-text-muted hover:bg-surface-2"
                  }`}
                  title={extraTitle}
                >
                  <input
                    type="checkbox"
                    className="w-3 h-3"
                    checked={pending}
                    onChange={() => togglePendingExtra(extra)}
                  />
                  <span className="font-medium">[{extra}]</span>
                  <span className="opacity-70">not installed</span>
                </label>
              );
            })}
            {pendingExtras.length > 0 && (
              <button
                onClick={handleInstallExtras}
                disabled={extrasActionLoading}
                className="text-xs px-2.5 py-1 rounded bg-primary text-white hover:opacity-90 disabled:opacity-50"
              >
                {extrasActionLoading
                  ? "Installing…"
                  : `Install [proxy,${pendingExtras.join(",")}]`}
              </button>
            )}
          </div>
          {extrasActionError && (
            <p className="text-xs text-error mt-1">{extrasActionError}</p>
          )}
          {restartingProxy && (
            <p className="text-xs text-text-muted mt-1">Restarting proxy…</p>
          )}
          {(extrasActionLoading || removingExtra) && installLog && (
            <pre className="mt-2 max-h-32 overflow-auto rounded bg-surface-2 p-2 text-[10px] leading-tight text-text-muted whitespace-pre-wrap">
              {installLog}
            </pre>
          )}
          <p className="text-xs text-text-muted mt-1">
            Installing adds the package; use <code>on</code>/<code>off</code>{" "}
            to activate it (restarts the proxy). Default install is{" "}
            <code>[proxy]</code> only (SmartCrusher for JSON). Adding{" "}
            <code>[code]</code> enables AST compression
            (Python/JS/TS/Go/Rust/Java/C/C++/Perl). Adding <code>[ml]</code>{" "}
            enables the Kompress-v2 HF model for prose/agentic traces but
            adds ~1 GB (torch + huggingface-hub).
          </p>
        </div>
      )}
      <div className="flex items-center justify-between pt-4 border-t border-border gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            Compress LLM output{" "}
            <a
              href="https://github.com/JuliusBrussee/caveman"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-normal text-primary underline hover:opacity-80"
            >
              (Caveman)
            </a>
          </p>
          <p className="text-sm text-text-muted">
            Terse-style system prompt → ~65% fewer output tokens (up to 87%)
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {cavemanEnabled && (
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1.5">
                {visibleCavemanLevels.map((lvl) => (
                  <button
                    key={lvl.id}
                    onClick={() => handleCavemanLevel(lvl.id)}
                    className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                      cavemanLevel === lvl.id
                        ? "bg-primary text-white border-primary"
                        : "bg-transparent border-border text-text-muted hover:bg-surface-2"
                    }`}
                    title={lvl.desc}
                  >
                    {lvl.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-primary">
                {cavemanLevels.find((lvl) => lvl.id === cavemanLevel)?.desc}
              </p>
            </div>
          )}
          <Toggle
            checked={cavemanEnabled}
            onChange={() => handleCavemanEnabled(!cavemanEnabled)}
          />
        </div>
      </div>
      <div className="flex items-center justify-between pt-4 mt-4 border-t border-border gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            Lazy senior dev{" "}
            <a
              href="https://github.com/DietrichGebert/ponytail"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-normal text-primary underline hover:opacity-80"
            >
              (Ponytail)
            </a>
          </p>
          <p className="text-sm text-text-muted">
            Bias the model toward minimal code: YAGNI, reuse stdlib,
            deletion over addition
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {ponytailEnabled && (
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1.5">
                {ponytailLevels.map((lvl) => (
                  <button
                    key={lvl.id}
                    onClick={() => handlePonytailLevel(lvl.id)}
                    className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                      ponytailLevel === lvl.id
                        ? "bg-primary text-white border-primary"
                        : "bg-transparent border-border text-text-muted hover:bg-surface-2"
                    }`}
                    title={lvl.desc}
                  >
                    {lvl.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-primary">
                {ponytailLevels.find((lvl) => lvl.id === ponytailLevel)?.desc}
              </p>
            </div>
          )}
          <Toggle
            checked={ponytailEnabled}
            onChange={() => handlePonytailEnabled(!ponytailEnabled)}
          />
        </div>
      </div>
      {/* Custom system prompt */}
      <div className="flex items-center justify-between pt-4 mt-4 border-t border-border gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="font-medium">Custom system prompt</p>
          <p className="text-sm text-text-muted">
            Appends your own instruction to every request, independently of the
            savers above
          </p>
        </div>
        <Toggle
          checked={customPromptEnabled}
          onChange={() => handleCustomPromptEnabled(!customPromptEnabled)}
        />
      </div>
      {customPromptEnabled && (
        <div className="pt-3">
          <textarea
            id="custom-prompt"
            aria-label="Custom system prompt"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            onBlur={handleCustomPromptBlur}
            rows={4}
            placeholder="e.g. Prefer editing existing files over creating new ones."
            className="w-full rounded border border-border bg-transparent p-2 text-xs"
          />
          <p className="text-xs text-text-muted mt-1">
            Applied to every provider and model. Sent as-is to upstream; an
            empty prompt injects nothing.
          </p>
        </div>
      )}
      {/* PXPIPE integration card */}
      <div className="flex items-center justify-between pt-4 mt-4 border-t border-border gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <p className="font-medium">
              Compress prompts as images{" "}
              <a
                href="https://github.com/teamchong/pxpipe"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (PXPIPE)
              </a>
            </p>
            <span className={`text-xs px-2 py-0.5 rounded ${pxpipeChipClass}`}>
              {pxpipeStatusLabel}
            </span>
            <button
              type="button"
              onClick={() => setShowPxpipeModal(true)}
              className="text-xs text-primary underline hover:opacity-80"
            >
              {pxpipeStatus.installed ? "Manage" : "Setup"}
            </button>
            <a
              href="/dashboard/pxpipe"
              className="text-xs text-primary underline hover:opacity-80"
            >
              Dashboard
            </a>
          </div>
          <p className="text-sm text-text-muted mt-1">
            Transforms large textual context into optimized images before
            sending to the LLM. Ideal for huge prompts, tool outputs and long
            conversations.
          </p>
        </div>
        <Toggle
          checked={pxpipeEnabled}
          disabled={!pxpipeStatus.installed}
          onChange={() => handlePxpipeEnabled(!pxpipeEnabled)}
        />
      </div>
    </Card>
  );
}
