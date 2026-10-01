"use client";

import React from "react";

export interface ChatLineProps {
  id: string;
  username: string;
  color: string;
  text: string;
  kind?: string;
  fontSize?: number;
  showAiBadge?: boolean;
}

export function ChatLine({
  username,
  color,
  text,
  kind,
  fontSize = 16,
  showAiBadge = false,
}: ChatLineProps) {
  return (
    <div
      className="flex items-start gap-2 py-1 px-2.5 rounded hover:bg-white/5 transition-colors duration-150 animate-chat-enter"
      style={{ fontSize: `${fontSize}px` }}
    >
      <div className="flex items-center gap-1.5 shrink-0">
        <span
          className="font-bold tracking-tight select-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
          style={{ color: color || "#38bdf8" }}
        >
          {username}
        </span>
        <span className="text-zinc-500 font-semibold select-none">:</span>
      </div>
      <span className="text-zinc-100 font-medium break-words leading-snug drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
        {text}
      </span>
      {showAiBadge && (
        <span className="ml-auto text-[10px] text-zinc-500 font-mono uppercase bg-zinc-800/80 px-1 py-0.5 rounded">
          {kind || "bot"}
        </span>
      )}
    </div>
  );
}
