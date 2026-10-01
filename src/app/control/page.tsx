"use client";

import React, { useState, useEffect, useCallback } from "react";
import { gql } from "@apollo/client";
import { useQuery, useMutation, useSubscription } from "@apollo/client/react";
import { useSTTAdapter } from "@/hooks/useSTTAdapter";
import { ControlSlider } from "@/components/ControlSlider";
import { DirectorPanel } from "@/components/DirectorPanel";
import { HypeDebugPanel } from "@/components/HypeDebugPanel";
import { ProviderStats, ProviderStatItem } from "@/components/ProviderStats";
import { ChatLine } from "@/components/ChatLine";
import {
  Mic,
  MicOff,
  Flame,
  Laugh,
  HelpCircle,
  Send,
  Power,
  Volume2,
  Trash2,
  Radio,
  Sliders,
  Settings as SettingsIcon,
  Sparkles,
} from "lucide-react";

const GET_CONTROL_STATE = gql`
  query GetControlState {
    settings {
      botCount
      momentDepth
      speedMultiplier
      enabled
      ambientChatter
      aiLabel
    }
    activePersonas {
      id
      username
      color
      ageGroup
      vibe
      energy
    }
    providerStats {
      name
      healthy
      cooldownUntil
      callsPerMin
      active
    }
    recentChat(limit: 15) {
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

const UPDATE_SETTINGS = gql`
  mutation UpdateSettings($input: SettingsInput!) {
    updateSettings(input: $input) {
      botCount
      momentDepth
      speedMultiplier
      enabled
      ambientChatter
      aiLabel
    }
  }
`;

const SUBMIT_TRANSCRIPT = gql`
  mutation SubmitTranscript($text: String!, $isFinal: Boolean!) {
    submitTranscript(text: $text, isFinal: $isFinal)
  }
`;

const TRIGGER_REACTION = gql`
  mutation TriggerReaction($kind: String!, $text: String) {
    triggerReaction(kind: $kind, text: $text)
  }
`;

const CLEAR_CHAT = gql`
  mutation ClearChat {
    clearChat
  }
`;

const DIRECTOR_SUBSCRIPTION = gql`
  subscription OnDirectorDecision {
    directorDecision {
      react
      eventType
      intensity
      reason
      ts
    }
  }
`;

const TRANSCRIPT_SUBSCRIPTION = gql`
  subscription OnTranscript {
    transcript
  }
`;

const PROVIDER_STATS_SUBSCRIPTION = gql`
  subscription OnProviderStats {
    providerStats {
      name
      healthy
      cooldownUntil
      callsPerMin
      active
    }
  }
`;

const CHAT_SUBSCRIPTION = gql`
  subscription OnChatMessageControl {
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

const HYPE_TELEMETRY_SUBSCRIPTION = gql`
  subscription OnHypeTelemetryControl {
    hypeTelemetry {
      score
      state
      signals {
        name
        value
        weight
        contribution
      }
      momentQuote
      eventType
      intensity
      tierUsed
      bankTotalCount
      bankUnusedCount
      batchCyclesLastHour
      reactiveCallsLastHour
      totalApiCallsLastHour
      blockedRequestsCount
      ts
    }
  }
`;

export default function ControlPage() {
  const [simulatedInput, setSimulatedInput] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [directorDecision, setDirectorDecision] = useState<any>(null);
  const [providerStats, setProviderStats] = useState<ProviderStatItem[]>([]);
  const [chatMessages, setChatMessages] = useState<any[]>([]);

  // Settings local state
  const [botCount, setBotCount] = useState(20);
  const [momentDepth, setMomentDepth] = useState(5);
  const [speedMultiplier, setSpeedMultiplier] = useState(1.0);
  const [enabled, setEnabled] = useState(true);
  const [ambientChatter, setAmbientChatter] = useState(true);
  const [aiLabel, setAiLabel] = useState(false);

  // Queries & Mutations
  const { data: initialData, loading } = useQuery<any>(GET_CONTROL_STATE);

  useEffect(() => {
    if (initialData?.settings) {
      setBotCount(initialData.settings.botCount);
      setMomentDepth(initialData.settings.momentDepth);
      setSpeedMultiplier(initialData.settings.speedMultiplier);
      setEnabled(initialData.settings.enabled);
      setAmbientChatter(initialData.settings.ambientChatter);
      setAiLabel(initialData.settings.aiLabel);
    }
    if (initialData?.providerStats) {
      setProviderStats(initialData.providerStats);
    }
    if (initialData?.recentChat) {
      setChatMessages(initialData.recentChat);
    }
  }, [initialData]);

  const [updateSettingsMutation] = useMutation(UPDATE_SETTINGS);
  const [submitTranscriptMutation] = useMutation(SUBMIT_TRANSCRIPT);
  const [triggerReactionMutation] = useMutation(TRIGGER_REACTION);
  const [clearChatMutation] = useMutation(CLEAR_CHAT);

  // Subscriptions
  useSubscription(DIRECTOR_SUBSCRIPTION, {
    onData: ({ data }: any) => {
      if (data?.data?.directorDecision) {
        setDirectorDecision(data.data.directorDecision);
      }
    },
  });

  useSubscription(TRANSCRIPT_SUBSCRIPTION, {
    onData: ({ data }: any) => {
      if (data?.data?.transcript) {
        setLiveTranscript(data.data.transcript);
      }
    },
  });

  useSubscription(PROVIDER_STATS_SUBSCRIPTION, {
    onData: ({ data }: any) => {
      if (data?.data?.providerStats) {
        setProviderStats(data.data.providerStats);
      }
    },
  });

  useSubscription(CHAT_SUBSCRIPTION, {
    onData: ({ data }: any) => {
      if (data?.data?.chatMessage) {
        setChatMessages((prev) => [data.data.chatMessage, ...prev].slice(0, 20));
      }
    },
  });

  const [hypeTelemetry, setHypeTelemetry] = useState<any>(null);

  useSubscription(HYPE_TELEMETRY_SUBSCRIPTION, {
    onData: ({ data }: any) => {
      if (data?.data?.hypeTelemetry) {
        setHypeTelemetry(data.data.hypeTelemetry);
      }
    },
  });

  // Speech-to-Text Hook (Groq Whisper Turbo + Web Speech API)
  const {
    engine,
    setEngine,
    isListening,
    permissionStatus,
    audioLevel,
    isProcessing,
    error: sttError,
    startListening,
    stopListening,
  } = useSTTAdapter({
    onTranscriptEvent: (event) => {
      setLiveTranscript(event.text);
      if (event.is_final) {
        submitTranscriptMutation({
          variables: { text: event.text, isFinal: true },
        });
      }
    },
  });

  const handleUpdateSetting = useCallback(
    (field: string, value: any) => {
      const input = {
        botCount,
        momentDepth,
        speedMultiplier,
        enabled,
        ambientChatter,
        aiLabel,
        [field]: value,
      };
      updateSettingsMutation({ variables: { input } });
    },
    [botCount, momentDepth, speedMultiplier, enabled, ambientChatter, aiLabel, updateSettingsMutation]
  );

  const handleSimulatedSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!simulatedInput.trim()) return;
    submitTranscriptMutation({
      variables: { text: simulatedInput.trim(), isFinal: true },
    });
    setSimulatedInput("");
  };

  const handleTrigger = (kind: string) => {
    triggerReactionMutation({ variables: { kind } });
  };

  const handleClearChat = () => {
    clearChatMutation();
    setChatMessages([]);
  };

  return (
    <div className="min-h-screen bg-[#030712] text-slate-100 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Bar */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-6 border-b border-zinc-800 gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
                <Sparkles className="w-6 h-6 text-cyan-400" />
                CrowdChat Control Panel
              </h1>
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-cyan-950/80 text-cyan-400 border border-cyan-800/60">
                LIVE
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Simulated audience director and real-time speech telemetry
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Master Enable Button */}
            <button
              onClick={() => {
                const next = !enabled;
                setEnabled(next);
                handleUpdateSetting("enabled", next);
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition-all ${
                enabled
                  ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20"
                  : "bg-zinc-800 hover:bg-zinc-700 text-zinc-400"
              }`}
            >
              <Power className="w-4 h-4" />
              <span>{enabled ? "AUDIENCE ACTIVE" : "AUDIENCE PAUSED"}</span>
            </button>

            {/* Clear Chat */}
            <button
              onClick={handleClearChat}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 text-xs font-medium transition-colors"
              title="Clear recent chat"
            >
              <Trash2 className="w-4 h-4" />
              <span>Clear</span>
            </button>
          </div>
        </header>

        {/* Main Grid: Controls vs Live Feed */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Sliders & Settings (5 cols) */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-5 space-y-5 shadow-xl">
              <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/80">
                <Sliders className="w-4 h-4 text-cyan-400" />
                <h2 className="text-sm font-bold text-zinc-200 uppercase tracking-wider">
                  Audience Dynamics
                </h2>
              </div>

              {/* Bot Count Slider */}
              <ControlSlider
                label="Bot Count (Active Roster)"
                value={botCount}
                min={5}
                max={100}
                step={5}
                description="Resizes active audience. Missing personas are generated automatically."
                onChange={(val) => {
                  setBotCount(val);
                  handleUpdateSetting("botCount", val);
                }}
              />

              {/* Moment Depth Slider */}
              <ControlSlider
                label="Moment Depth"
                value={momentDepth}
                min={0}
                max={10}
                step={1}
                description="Biases Director intensity. 0 = chill & sparse. 10 = chaotic, fast roasts."
                onChange={(val) => {
                  setMomentDepth(val);
                  handleUpdateSetting("momentDepth", val);
                }}
              />

              {/* Speed Multiplier Slider */}
              <ControlSlider
                label="Chat Speed Multiplier"
                value={speedMultiplier}
                min={0.2}
                max={3.0}
                step={0.1}
                unit="x"
                description="Scales release delay intervals between burst messages."
                onChange={(val) => {
                  setSpeedMultiplier(val);
                  handleUpdateSetting("speedMultiplier", val);
                }}
              />

              {/* Toggle Switches */}
              <div className="pt-2 border-t border-zinc-800/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-semibold text-zinc-200">
                      Ambient Idle Chatter
                    </label>
                    <p className="text-[11px] text-zinc-500">
                      Fires low-intensity comments during 45-120s quiet moments
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={ambientChatter}
                    onChange={(e) => {
                      setAmbientChatter(e.target.checked);
                      handleUpdateSetting("ambientChatter", e.target.checked);
                    }}
                    className="w-4 h-4 accent-cyan-400 cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-semibold text-zinc-200">
                      Show AI Label on Overlay
                    </label>
                    <p className="text-[11px] text-zinc-500">
                      Displays a subtle &quot;AI Simulated&quot; badge on OBS Browser Source
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={aiLabel}
                    onChange={(e) => {
                      setAiLabel(e.target.checked);
                      handleUpdateSetting("aiLabel", e.target.checked);
                    }}
                    className="w-4 h-4 accent-cyan-400 cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Manual Test Triggers */}
            <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-5 space-y-4 shadow-xl">
              <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/80">
                <Flame className="w-4 h-4 text-orange-400" />
                <h2 className="text-sm font-bold text-zinc-200 uppercase tracking-wider">
                  Instant Test Triggers
                </h2>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => handleTrigger("hype")}
                  className="flex flex-col items-center justify-center p-3 rounded-xl bg-orange-950/40 hover:bg-orange-900/60 border border-orange-800/60 text-orange-300 font-bold text-xs transition-all hover:scale-105 active:scale-95"
                >
                  <Flame className="w-5 h-5 mb-1 text-orange-400" />
                  Hype Burst
                </button>

                <button
                  onClick={() => handleTrigger("troll")}
                  className="flex flex-col items-center justify-center p-3 rounded-xl bg-purple-950/40 hover:bg-purple-900/60 border border-purple-800/60 text-purple-300 font-bold text-xs transition-all hover:scale-105 active:scale-95"
                >
                  <Laugh className="w-5 h-5 mb-1 text-purple-400" />
                  Troll Wave
                </button>

                <button
                  onClick={() => handleTrigger("question")}
                  className="flex flex-col items-center justify-center p-3 rounded-xl bg-sky-950/40 hover:bg-sky-900/60 border border-sky-800/60 text-sky-300 font-bold text-xs transition-all hover:scale-105 active:scale-95"
                >
                  <HelpCircle className="w-5 h-5 mb-1 text-sky-400" />
                  Question
                </button>
              </div>

              {/* Simulated Transcript Textbox */}
              <form onSubmit={handleSimulatedSubmit} className="pt-2 space-y-2">
                <label className="text-xs text-zinc-400 font-medium">
                  Simulate Speech Transcript:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={simulatedInput}
                    onChange={(e) => setSimulatedInput(e.target.value)}
                    placeholder="e.g. 'No way, I hate this game, I'm done!'"
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                  <button
                    type="submit"
                    className="px-3.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold flex items-center gap-1 transition-all"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send</span>
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Right Column: STT Microphone, Director, Providers & Chat Preview (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            {/* Live STT Microphone Card */}
            <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-5 space-y-4 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-zinc-800/80">
                <div className="flex items-center gap-2">
                  <Radio className={`w-4 h-4 ${isListening ? "text-red-400 animate-ping" : "text-cyan-400"}`} />
                  <h2 className="text-sm font-bold text-zinc-200 uppercase tracking-wider">
                    Microphone & Speech-to-Text
                  </h2>
                  {isListening && (
                    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                      MIC ACTIVE
                    </span>
                  )}
                  {isProcessing && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 animate-pulse">
                      ⚡ Transcribing...
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {/* Browser permission status pill */}
                  <span
                    className={`text-[10px] font-mono px-2 py-1 rounded-lg border font-semibold ${
                      permissionStatus === "granted"
                        ? "bg-emerald-950/60 text-emerald-400 border-emerald-800/50"
                        : permissionStatus === "denied"
                        ? "bg-red-950/60 text-red-400 border-red-800/50"
                        : "bg-zinc-900 text-zinc-400 border-zinc-800"
                    }`}
                  >
                    Permission: {permissionStatus.toUpperCase()}
                  </span>

                  <button
                    onClick={async () => {
                      if (isListening) {
                        stopListening();
                      } else {
                        await startListening();
                      }
                    }}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition-all shadow-md active:scale-95 ${
                      isListening
                        ? "bg-red-600 hover:bg-red-500 text-white shadow-red-600/30 animate-pulse ring-2 ring-red-400/40"
                        : "bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-600/20"
                    }`}
                  >
                    {isListening ? (
                      <>
                        <MicOff className="w-4 h-4" /> Stop Mic
                      </>
                    ) : (
                      <>
                        <Mic className="w-4 h-4 text-white" /> Start Mic
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Engine Selector */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-xs">
                <span className="text-zinc-400 font-medium text-[11px]">STT Engine:</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (isListening) stopListening();
                      setEngine("whisper");
                    }}
                    className={`px-2.5 py-1 rounded-lg font-medium text-[11px] transition-all ${
                      engine === "whisper"
                        ? "bg-cyan-600 text-white shadow font-semibold"
                        : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    ⚡ Groq Whisper Turbo (Universal)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isListening) stopListening();
                      setEngine("webspeech");
                    }}
                    className={`px-2.5 py-1 rounded-lg font-medium text-[11px] transition-all ${
                      engine === "webspeech"
                        ? "bg-cyan-600 text-white shadow font-semibold"
                        : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    🌐 Web Speech API (Chrome)
                  </button>
                </div>
              </div>

              {/* Live Audio Level Meter when mic is active */}
              {isListening && (
                <div className="space-y-1.5 bg-zinc-900/80 border border-zinc-800 rounded-xl p-3">
                  <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      Live Audio Input Level:
                    </span>
                    <span className="text-zinc-200 font-bold">{audioLevel}%</span>
                  </div>
                  <div className="w-full h-2.5 bg-zinc-950 rounded-full overflow-hidden border border-zinc-800">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 via-cyan-400 to-amber-400 transition-all duration-75 rounded-full"
                      style={{ width: `${Math.max(4, audioLevel)}%` }}
                    />
                  </div>
                </div>
              )}

              {permissionStatus === "denied" && (
                <div className="text-xs text-red-300 bg-red-950/50 border border-red-800/70 rounded-xl p-3 space-y-1.5">
                  <div className="font-bold flex items-center gap-1.5 text-red-200">
                    <span>⚠️ Microphone Permission Blocked in Browser</span>
                  </div>
                  <p className="text-zinc-300 leading-relaxed">
                    Your browser has microphone access set to <strong>Block</strong> for <code className="bg-black/60 px-1 py-0.5 rounded text-red-300">http://localhost:3002</code>.
                  </p>
                  <div className="text-[11px] text-zinc-400 space-y-1 pt-1">
                    <div>1. Click the <strong>lock / site settings icon (🎛️)</strong> in the URL bar (to the left of <code className="text-zinc-300">http://localhost:3002</code>).</div>
                    <div>2. Change <strong>Microphone</strong> from <em>Block</em> to <strong>Allow</strong>.</div>
                    <div>3. On Mac: Open <strong>Apple  &gt; System Settings &gt; Privacy &amp; Security &gt; Microphone</strong> and verify Google Chrome is enabled.</div>
                    <div>4. Hard refresh this page (<kbd className="bg-zinc-800 px-1.5 py-0.5 rounded text-[10px] text-zinc-200 font-mono">Cmd + Shift + R</kbd>) and click <strong>Start Mic</strong>.</div>
                    <div className="text-cyan-400/90 pt-1 font-medium">💡 Tip: You can also test right now using the Instant Test Triggers or the Simulate Speech box on the left!</div>
                  </div>
                </div>
              )}

              {sttError && permissionStatus !== "denied" && (
                <div className="text-xs text-amber-300 bg-amber-950/50 border border-amber-800/70 rounded-xl p-3 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <span>ℹ️ Speech Status</span>
                  </div>
                  <p>{sttError}</p>
                </div>
              )}

              <div className={`border rounded-xl p-3 min-h-[65px] flex flex-col justify-center transition-colors ${
                isListening ? "bg-cyan-950/20 border-cyan-800/50" : "bg-zinc-900/60 border-zinc-800/80"
              }`}>
                <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono uppercase mb-1">
                  <span>Live Detected Transcript:</span>
                  {isListening && (
                    <span className="text-cyan-400 font-bold animate-pulse">
                      ● {isProcessing ? "Transcribing (Groq Whisper)..." : `Listening (${engine === "whisper" ? "Groq Whisper" : "Web Speech"})...`}
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-200 italic font-mono leading-relaxed">
                  {liveTranscript
                    ? `"${liveTranscript}"`
                    : isListening
                    ? "Speak into your mic — speech will be transcribed and fed to the Director automatically..."
                    : "Click 'Start Mic' above or use the test triggers on the left."}
                </p>
              </div>
            </div>

            {/* Live Multi-Signal Hype Detector & Three-Tier Debug Panel */}
            <HypeDebugPanel telemetry={hypeTelemetry} />

            {/* AI Director Decision Card */}
            <DirectorPanel decision={directorDecision} />

            {/* LLM Provider Stats & Failover Card */}
            <ProviderStats stats={providerStats} />

            {/* Live Chat Stream Preview */}
            <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-5 space-y-3 shadow-xl">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-cyan-400" />
                  <h2 className="text-sm font-bold text-zinc-200 uppercase tracking-wider">
                    Recent Audience Reactions
                  </h2>
                </div>
                <span className="text-xs text-zinc-500 font-mono">
                  {chatMessages.length} visible
                </span>
              </div>

              <div className="bg-black/50 border border-zinc-800/80 rounded-xl p-3 max-h-56 overflow-y-auto space-y-1">
                {chatMessages.length === 0 ? (
                  <p className="text-xs text-zinc-600 text-center py-4">
                    No reactions yet. Speak into your mic or press a trigger button!
                  </p>
                ) : (
                  chatMessages.map((m) => (
                    <ChatLine
                      key={m.id}
                      id={m.id}
                      username={m.username}
                      color={m.color}
                      text={m.text}
                      kind={m.kind}
                      showAiBadge={true}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
