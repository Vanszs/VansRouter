"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Input, Modal, Select, Toggle } from "@/shared/components";
import {
  PING_SCHEDULE_DEFAULTS,
  getScheduleSlotLabels,
  maxSlotsPerDay,
  parseAnchor,
} from "@/shared/services/quotaPingSchedule";

const TIMEZONE_OPTIONS = [
  { value: "America/Sao_Paulo", label: "America/Sao_Paulo (BRT)" },
  { value: "America/New_York", label: "America/New_York" },
  { value: "Europe/Lisbon", label: "Europe/Lisbon" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "UTC", label: "UTC" },
];

function toFormState(schedule) {
  return {
    enabled: schedule?.enabled === true,
    anchor: schedule?.anchor || PING_SCHEDULE_DEFAULTS.anchor,
    timezone: schedule?.timezone || PING_SCHEDULE_DEFAULTS.timezone,
    windowHours: String(schedule?.windowHours ?? PING_SCHEDULE_DEFAULTS.windowHours),
    slotsPerDay: String(schedule?.slotsPerDay ?? PING_SCHEDULE_DEFAULTS.slotsPerDay),
  };
}

export default function AutoPingScheduleModal({ isOpen, onClose, onSave, connection, schedule }) {
  // Mounted only while the modal is open, so the initial state is always fresh.
  const [form, setForm] = useState(() => toFormState(schedule));

  const windowHours = Number(form.windowHours);
  const slotsPerDay = Number(form.slotsPerDay);
  const anchorValid = Boolean(parseAnchor(form.anchor));
  const windowValid = Number.isFinite(windowHours) && windowHours >= 0.5 && windowHours <= 24;
  const slotsMax = windowValid ? maxSlotsPerDay(windowHours) : 24;
  const slotsValid = Number.isInteger(slotsPerDay) && slotsPerDay >= 1 && slotsPerDay <= slotsMax;
  const canSave = anchorValid && windowValid && slotsValid;

  const previewSlots = canSave
    ? getScheduleSlotLabels({ enabled: true, ...form, windowHours, slotsPerDay })
    : [];

  // Last slot's window end — the moment coverage stops until the next anchor.
  const coverageEnd = previewSlots.length && windowValid
    ? (() => {
      const { hour, minute } = parseAnchor(form.anchor);
      const total = Math.round(hour * 60 + minute + slotsPerDay * windowHours * 60) % 1440;
      return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    })()
    : "";

  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      enabled: form.enabled,
      anchor: form.anchor,
      timezone: form.timezone,
      windowHours,
      slotsPerDay,
    });
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Scheduled ping"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-sm text-text-muted">
          Pings at fixed local times so the 5h windows line up with the hours you actually work.
          The overnight gap is what pulls the next day back onto the anchor.
          Works on its own{connection?.name ? ` for ${connection.name}` : ""}, and runs alongside auto-ping when that is on too.
        </p>

        <div className="flex items-center justify-between rounded-[10px] bg-surface-2 px-3 py-2.5">
          <span className="text-sm font-medium text-text-main">Enable schedule</span>
          <Toggle checked={form.enabled} onChange={(next) => update({ enabled: next })} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Anchor time"
            type="time"
            value={form.anchor}
            onChange={(e) => update({ anchor: e.target.value })}
            error={anchorValid ? "" : "Use HH:MM"}
          />
          <Select
            label="Timezone"
            options={TIMEZONE_OPTIONS}
            value={form.timezone}
            onChange={(e) => update({ timezone: e.target.value })}
          />
          <Input
            label="Window length (hours)"
            type="number"
            min="0.5"
            max="24"
            step="0.5"
            value={form.windowHours}
            onChange={(e) => update({ windowHours: e.target.value })}
            error={windowValid ? "" : "0.5 – 24"}
          />
          <Input
            label="Pings per day"
            type="number"
            min="1"
            max={String(slotsMax)}
            step="1"
            value={form.slotsPerDay}
            onChange={(e) => update({ slotsPerDay: e.target.value })}
            error={slotsValid ? "" : `1 – ${slotsMax}`}
            hint={slotsValid ? `Max ${slotsMax} without overlapping the next anchor` : ""}
          />
        </div>

        {previewSlots.length > 0 && (
          <div className="rounded-[10px] bg-surface-2 px-3 py-2.5">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Daily slots</p>
            <p className="mt-1 text-sm text-text-main">{previewSlots.join("  →  ")}</p>
            <p className="mt-1 text-xs text-text-muted">
              Covers {previewSlots[0]} – {coverageEnd} ({form.timezone}), then pauses until {previewSlots[0]} next day.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

AutoPingScheduleModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  connection: PropTypes.object,
  schedule: PropTypes.object,
};
