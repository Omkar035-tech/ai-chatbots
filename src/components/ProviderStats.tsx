"use client";

import React from "react";
import { Server, Activity, AlertCircle, CheckCircle, ShieldAlert } from "lucide-react";

export interface ProviderStatItem {
  name: string;
  healthy: boolean;
  cooldownUntil: number | null;
  callsPerMin: number;
  active: boolean;
}

export interface ProviderStatsProps {
  stats: ProviderStatItem[];
}

export function ProviderStats({ stats }: ProviderStatsProps) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-zinc-200">LLM Provider Health & Failover</h3>
        </div>
        <span className="text-[11px] text-zinc-500 font-mono">Live Telemetry</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {stats.map((s) => {
          const inCooldown = s.cooldownUntil && s.cooldownUntil > Date.now();
          const cooldownRemaining = inCooldown
            ? Math.round((s.cooldownUntil! - Date.now()) / 1000)
            : 0;

          return (
            <div
              key={s.name}
              className={`p-3 rounded-xl border transition-all ${
                s.active
                  ? "bg-cyan-950/30 border-cyan-500/60 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
                  : "bg-zinc-950/60 border-zinc-800/80"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-xs uppercase text-zinc-100 tracking-wider">
                    {s.name}
                  </span>
                  {s.active && (
                    <span className="text-[9px] font-bold text-cyan-400 bg-cyan-950/80 border border-cyan-800/60 px-1.5 py-0.5 rounded-full animate-pulse">
                      ACTIVE
                    </span>
                  )}
                </div>

                {inCooldown ? (
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                ) : s.healthy ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-400" />
                )}
              </div>

              <div className="flex items-center justify-between text-xs text-zinc-400 font-mono">
                <span>Calls/min:</span>
                <span className="text-zinc-200 font-bold">{s.callsPerMin}</span>
              </div>

              <div className="mt-1 text-[11px] font-mono">
                {inCooldown ? (
                  <span className="text-amber-400">Cooldown: {cooldownRemaining}s</span>
                ) : s.healthy ? (
                  <span className="text-emerald-400">Healthy & Ready</span>
                ) : (
                  <span className="text-zinc-500">Idle / Standby</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
