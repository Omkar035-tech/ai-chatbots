"use client";

import React, { useEffect, useState, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { gql } from "@apollo/client";
import { useSubscription, useQuery } from "@apollo/client/react";
import { ChatLine } from "@/components/ChatLine";
import { cachePersonas, getCachedPersonas, CachedPersona } from "@/lib/idb";

const CHAT_MESSAGE_SUBSCRIPTION = gql`
  subscription OnChatMessage {
    chatMessage {
      id
      personaId
      username
      color
      text
      kind
      ts
    }
  }
`;

const ROSTER_SUBSCRIPTION = gql`
  subscription OnRosterUpdated {
    rosterUpdated {
      id
      username
      color
      ageGroup
      vibe
      energy
    }
  }
`;

const GET_SETTINGS = gql`
  query GetOverlaySettings {
    settings {
      aiLabel
    }
    recentChat(limit: 20) {
      id
      personaId
      username
      color
      text
      kind
      ts
    }
  }
`;

interface MessageItem {
  id: string;
  personaId: string;
  username: string;
  color: string;
  text: string;
  kind?: string;
  ts: number;
}

function OverlayContent() {
  const searchParams = useSearchParams();
  const widthParam = searchParams.get("width");
  const fontParam = searchParams.get("font");
  const fadeParam = searchParams.get("fade");

  const width = widthParam ? parseInt(widthParam, 10) : 420;
  const fontSize = fontParam ? parseInt(fontParam, 10) : 16;
  const enableFade = fadeParam !== "0";

  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [showAiLabel, setShowAiLabel] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load initial settings and recent chat
  const { data: initialData } = useQuery<any>(GET_SETTINGS);

  useEffect(() => {
    if (initialData?.settings) {
      setShowAiLabel(initialData.settings.aiLabel);
    }
    if (initialData?.recentChat && Array.isArray(initialData.recentChat)) {
      // Reverse so newest are at the bottom
      const reversed = [...initialData.recentChat].reverse();
      setMessages(reversed);
    }
  }, [initialData]);

  // Listen to live chat stream
  useSubscription(CHAT_MESSAGE_SUBSCRIPTION, {
    onData: ({ data }: any) => {
      const newMsg = data?.data?.chatMessage;
      if (newMsg) {
        setMessages((prev) => {
          const updated = [...prev, newMsg];
          // Keep max ~25 visible lines
          return updated.slice(-25);
        });
      }
    },
  });

  // Listen to roster updates and cache in IndexedDB
  useSubscription(ROSTER_SUBSCRIPTION, {
    onData: ({ data }: any) => {
      const roster = data?.data?.rosterUpdated;
      if (roster && Array.isArray(roster)) {
        cachePersonas(roster);
      }
    },
  });

  // Load cached roster from IndexedDB on startup
  useEffect(() => {
    getCachedPersonas().then((cached) => {
      if (cached && cached.length > 0) {
        // roster available
      }
    });
  }, []);

  // Auto-scroll to bottom as new messages arrive
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div
      className="relative flex flex-col justify-end h-screen w-full select-none overflow-hidden p-3"
      style={{
        width: width ? `${width}px` : "100%",
        maxWidth: "100vw",
        backgroundColor: "transparent",
      }}
    >
      <style jsx global>{`
        html,
        body {
          background-color: transparent !important;
          background: transparent !important;
          overflow: hidden !important;
          margin: 0;
          padding: 0;
        }
      `}</style>

      {/* Optional AI simulated chat badge */}
      {showAiLabel && (
        <div className="absolute top-2 right-2 z-10 px-2 py-0.5 rounded bg-black/60 border border-white/10 text-[10px] text-zinc-400 font-mono tracking-wider">
          AI Simulated Audience
        </div>
      )}

      {/* Messages container - bottom up */}
      <div
        ref={containerRef}
        className="flex flex-col justify-end space-y-1 overflow-y-auto no-scrollbar"
        style={{
          maskImage: enableFade
            ? "linear-gradient(to bottom, transparent 0%, black 15%)"
            : "none",
          WebkitMaskImage: enableFade
            ? "linear-gradient(to bottom, transparent 0%, black 15%)"
            : "none",
        }}
      >
        {messages.map((m) => (
          <ChatLine
            key={m.id}
            id={m.id}
            username={m.username}
            color={m.color}
            text={m.text}
            kind={m.kind}
            fontSize={fontSize}
          />
        ))}
      </div>
    </div>
  );
}

export default function OverlayPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-transparent" />}>
      <OverlayContent />
    </Suspense>
  );
}
