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

const TWITCH_EMOTES = new Set([
  "KEKW", "LUL", "OMEGALUL", "LULW", "Pog", "PogChamp",
  "monkaS", "Sadge", "Copium", "Clap", "5Head", "ICANT",
  "EZ", "GIGACHAD", "Pepega", "D:"
]);

export function ChatLine({
  username,
  color,
  text,
  kind,
  fontSize = 16,
  showAiBadge = false,
}: ChatLineProps) {
  // Parse text into words and identify emotes
  const words = text.split(/(\s+)/);

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

      <div className="text-zinc-100 font-medium break-words leading-snug drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] flex flex-wrap items-center gap-x-1">
        {words.map((part, idx) => {
          const trimmed = part.trim();
          if (TWITCH_EMOTES.has(trimmed)) {
            return (
              <span key={idx} className="inline-flex items-center">
                {/* Fallback to text emote if image doesn't exist */}
                <img
                  src={`/emotes/${trimmed}.png`}
                  alt={trimmed}
                  className="inline-block h-6 w-auto object-contain mx-0.5"
                  onError={(e) => {
                    // Hide failed image and display stylized text
                    e.currentTarget.style.display = "none";
                  }}
                />
                <span className="font-extrabold text-amber-300 px-1 py-0.2 bg-white/10 rounded text-[0.9em] border border-white/15">
                  {trimmed}
                </span>
              </span>
            );
          }
          return <span key={idx}>{part}</span>;
        })}
      </div>

      {showAiBadge && (
        <span className="ml-auto text-[10px] text-zinc-500 font-mono uppercase bg-zinc-800/80 px-1 py-0.5 rounded">
          {kind || "bot"}
        </span>
      )}
    </div>
  );
}
