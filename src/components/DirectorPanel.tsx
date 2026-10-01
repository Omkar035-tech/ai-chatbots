"use client";

import React from "react";
import { Sparkles, CheckCircle2, XCircle, Gauge } from "lucide-react";

export interface DirectorPanelProps {
  decision: {
    react: boolean;
    eventType: string;
    intensity: number;
    reason: string;
    ts: number;
  } | null;
}

export function DirectorPanel({ decision }: DirectorPanelProps) {
  if (!decision) {
    return (
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4 text-center text-zinc-500 text-sm">
        <Sparkles className="w-6 h-6 mx-auto mb-2 text-zinc-600 animate-pulse" />
        Awaiting live speech transcript...
      </div>
    );
  }

  const isYes = decision.react;
  const intensityColor =
    decision.intensity >= 8
      ? "text-red-400 bg-red-950/40 border-red-800/60"
      : decision.intensity >= 4
      ? "text-amber-400 bg-amber-950/40 border-amber-800/60"
      : "text-emerald-400 bg-emerald-950/40 border-emerald-800/60";

  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-zinc-200">Director Decision</h3>
        </div>
        <span className="text-[11px] text-zinc-500 font-mono">
          {new Date(decision.ts).toLocaleTimeString()}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-bold text-xs ${
            isYes
              ? "bg-emerald-950/70 text-emerald-400 border-emerald-700/60"
              : "bg-zinc-800/70 text-zinc-400 border-zinc-700/60"
          }`}
        >
          {isYes ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          <span>{isYes ? "REACT: YES" : "REACT: NO"}</span>
        </div>

        <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 font-mono">
          <span>Event:</span>
          <span className="text-cyan-400 font-semibold uppercase">{decision.eventType}</span>
        </div>

        <div
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-mono font-bold ${intensityColor}`}
        >
          <Gauge className="w-3.5 h-3.5" />
          <span>Intensity {decision.intensity}/10</span>
        </div>
      </div>

      <div className="text-xs text-zinc-300 bg-black/40 border border-zinc-800/80 rounded-lg p-2.5">
        <span className="text-zinc-500 font-semibold mr-1.5">Reason:</span>
        {decision.reason}
      </div>
    </div>
  );
}
