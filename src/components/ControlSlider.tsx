"use client";

import React from "react";

export interface ControlSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  description?: string;
  onChange: (val: number) => void;
}

export function ControlSlider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  description,
  onChange,
}: ControlSliderProps) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4 shadow-sm space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold text-zinc-200">{label}</label>
        <span className="font-mono text-xs px-2.5 py-1 bg-cyan-950/80 text-cyan-400 border border-cyan-800/50 rounded-lg font-bold">
          {value}
          {unit}
        </span>
      </div>

      {description && <p className="text-xs text-zinc-400">{description}</p>}

      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
      />

      <div className="flex justify-between text-[11px] text-zinc-500 font-mono">
        <span>
          {min}
          {unit}
        </span>
        <span>
          {max}
          {unit}
        </span>
      </div>
    </div>
  );
}
