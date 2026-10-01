"use client";

import React, { useState, useEffect } from "react";
import { Activity, Zap, Database, Server, AlertTriangle, Layers, TrendingUp } from "lucide-react";

export interface SignalItem {
  name: string;
  value: number;
  weight: number;
  contribution: number;
}

export interface HypeTelemetryData {
  score: number;
  state: string;
  signals: SignalItem[];
  momentQuote: string | null;
  eventType: string | null;
  intensity: number | null;
  tierUsed: string;
  bankTotalCount: number;
  bankUnusedCount: number;
  batchCyclesLastHour: number;
  reactiveCallsLastHour: number;
  totalApiCallsLastHour: number;
  blockedRequestsCount: number;
  ts: number;
}

export function HypeDebugPanel({ telemetry }: { telemetry: HypeTelemetryData | null }) {
  const [scoreHistory, setScoreHistory] = useState<number[]>([]);

  useEffect(() => {
    if (telemetry) {
      setScoreHistory((prev) => [...prev.slice(-24), telemetry.score]);
    }
  }, [telemetry?.score, telemetry?.ts]);

  if (!telemetry) {
    return (
      <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-5 space-y-3 shadow-xl text-center text-zinc-500 text-xs">
        <Activity className="w-5 h-5 mx-auto mb-1 text-zinc-600 animate-pulse" />
        Awaiting local hype detector telemetry...
      </div>
    );
  }

  const score = telemetry.score;
  const scorePercent = Math.min(100, Math.round(score * 10));

  const tierBadgeColor =
    telemetry.tierUsed === "tier2"
      ? "bg-purple-950/80 text-purple-300 border-purple-800/80"
      : telemetry.tierUsed === "tier1"
      ? "bg-blue-950/80 text-blue-300 border-blue-800/80"
      : telemetry.tierUsed === "tier0"
      ? "bg-emerald-950/80 text-emerald-300 border-emerald-800/80"
      : "bg-zinc-900 text-zinc-500 border-zinc-800";

  const tierLabel =
    telemetry.tierUsed === "tier2"
      ? "Tier 2: Reactive Micro-Call (30-50 lines)"
      : telemetry.tierUsed === "tier1"
      ? "Tier 1: Batch Refill (350+ lines)"
      : telemetry.tierUsed === "tier0"
      ? "Tier 0: Local Bank Matcher (0 API Calls)"
      : "None";

  const stateColor =
    telemetry.state === "PEAK"
      ? "text-red-400 bg-red-950/60 border-red-800/60"
      : telemetry.state === "MOMENT_START"
      ? "text-amber-400 bg-amber-950/60 border-amber-800/60"
      : telemetry.state === "DECAY"
      ? "text-cyan-400 bg-cyan-950/60 border-cyan-800/60"
      : "text-zinc-400 bg-zinc-900 border-zinc-800";

  return (
    <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-5 space-y-4 shadow-xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-zinc-800/80">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-bold text-zinc-200 uppercase tracking-wider">
            Live Hype Detector &amp; Three-Tier Engine
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border font-bold ${stateColor}`}>
            STATE: {telemetry.state}
          </span>
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border font-bold ${tierBadgeColor}`}>
            {tierLabel}
          </span>
        </div>
      </div>

      {/* Main Stats Row: Score Gauge + Sparkline + Bank + API Calls */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Hype Score */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
          <div className="text-[11px] text-zinc-400 font-medium">Hype Score</div>
          <div className="text-2xl font-black text-cyan-400 flex items-baseline gap-1 mt-0.5">
            {score.toFixed(1)}
            <span className="text-xs text-zinc-500 font-normal">/10.0</span>
          </div>
          <div className="w-full bg-zinc-950 h-1.5 rounded-full mt-2 overflow-hidden border border-zinc-800">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                score >= 6.2 ? "bg-red-500" : score >= 3.8 ? "bg-amber-400" : "bg-emerald-500"
              }`}
              style={{ width: `${scorePercent}%` }}
            />
          </div>
        </div>

        {/* Message Bank Counters */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
          <div className="text-[11px] text-zinc-400 font-medium flex items-center gap-1">
            <Database className="w-3 h-3 text-emerald-400" />
            Message Bank
          </div>
          <div className="text-xl font-black text-emerald-400 mt-0.5">
            {telemetry.bankUnusedCount}
            <span className="text-xs text-zinc-500 font-normal ml-1">unused</span>
          </div>
          <div className="text-[10px] text-zinc-500 mt-1 font-mono">
            {telemetry.bankTotalCount} total capacity
          </div>
        </div>

        {/* API Calls Last Hour */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
          <div className="text-[11px] text-zinc-400 font-medium flex items-center gap-1">
            <Server className="w-3 h-3 text-purple-400" />
            API Calls (1h)
          </div>
          <div className="text-xl font-black text-purple-400 mt-0.5">
            {telemetry.totalApiCallsLastHour}
            <span className="text-xs text-zinc-500 font-normal ml-1">/40 cap</span>
          </div>
          <div className="text-[10px] text-zinc-500 mt-1 font-mono">
            {telemetry.batchCyclesLastHour} batch · {telemetry.reactiveCallsLastHour} reactive
          </div>
        </div>

        {/* Safety / Blocked */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
          <div className="text-[11px] text-zinc-400 font-medium flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            Blocked Policy
          </div>
          <div className="text-xl font-black text-amber-400 mt-0.5">
            {telemetry.blockedRequestsCount}
          </div>
          <div className="text-[10px] text-zinc-500 mt-1 font-mono">
            Failover to bank
          </div>
        </div>
      </div>

      {/* Score Sparkline */}
      <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-3 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
          <span className="flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-cyan-400" />
            Rolling Score History (Hysteresis T_HIGH: 6.2, T_LOW: 3.8):
          </span>
          <span className="text-zinc-500">last {scoreHistory.length} hops</span>
        </div>
        <div className="flex items-end gap-1 h-9 pt-1">
          {scoreHistory.map((s, idx) => {
            const h = Math.max(8, Math.round((s / 10.0) * 100));
            const barColor =
              s >= 6.2
                ? "bg-red-400 hover:bg-red-300"
                : s >= 3.8
                ? "bg-amber-400 hover:bg-amber-300"
                : "bg-cyan-500/70 hover:bg-cyan-400";
            return (
              <div
                key={idx}
                title={`Score: ${s.toFixed(1)}`}
                className={`flex-1 rounded-t transition-all ${barColor}`}
                style={{ height: `${h}%` }}
              />
            );
          })}
        </div>
      </div>

      {/* Signal Contributions Breakdown */}
      <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-3 space-y-2">
        <div className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-cyan-400" />
          Multi-Signal Normalization Breakdown
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
          {telemetry.signals && telemetry.signals.length > 0 ? (
            telemetry.signals.map((sig) => (
              <div key={sig.name} className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
                  <span className="capitalize">{sig.name.replace(/([A-Z])/g, " $1")}</span>
                  <span className="text-zinc-300 font-semibold">
                    +{sig.contribution.toFixed(2)} (val: {sig.value.toFixed(2)})
                  </span>
                </div>
                <div className="w-full bg-zinc-950 h-1.5 rounded-full overflow-hidden border border-zinc-800">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-indigo-400 rounded-full"
                    style={{ width: `${Math.min(100, Math.round(sig.value * 100))}%` }}
                  />
                </div>
              </div>
            ))
          ) : (
            <p className="text-[11px] text-zinc-500 col-span-2 py-1">
              Waiting for live audio/speech signals to calculate normalized z-scores...
            </p>
          )}
        </div>
      </div>

      {/* Active / Last Moment Quote */}
      {telemetry.momentQuote && (
        <div className="text-xs bg-black/40 border border-zinc-800/80 rounded-xl p-3 space-y-1 font-mono">
          <div className="flex items-center justify-between text-[11px] text-zinc-400">
            <span className="text-cyan-400 font-semibold">Pinned Stream Moment:</span>
            <span className="text-zinc-500">
              Event: <strong className="text-zinc-300">{telemetry.eventType}</strong> · Intensity:{" "}
              <strong className="text-zinc-300">{telemetry.intensity}/10</strong>
            </span>
          </div>
          <p className="text-zinc-200 italic">&ldquo;{telemetry.momentQuote}&rdquo;</p>
        </div>
      )}
    </div>
  );
}
