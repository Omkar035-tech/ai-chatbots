import React from "react";
import Link from "next/link";
import { MessageSquare, Sliders, Monitor, Radio, Cpu, Sparkles } from "lucide-react";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#030712] text-slate-100 flex flex-col items-center justify-center p-6">
      <div className="max-w-3xl w-full text-center space-y-8">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-950/60 border border-cyan-800/60 text-cyan-400 text-xs font-semibold uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5" />
          CrowdChat AI Stream Portal
        </div>

        <h1 className="text-4xl sm:text-6xl font-black tracking-tight text-white">
          Simulated Chat Audience <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-sky-300 to-indigo-400">
            Reactive In Real-Time
          </span>
        </h1>

        <p className="text-base sm:text-lg text-slate-400 max-w-xl mx-auto leading-relaxed">
          AI-driven stream viewers with distinct personas reacting live to your voice.
          Designed specifically for OBS Browser Sources with zero latency.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left pt-4">
          <Link
            href="/control"
            className="group relative p-6 bg-zinc-900/80 hover:bg-zinc-800/80 border border-zinc-800 hover:border-cyan-500/50 rounded-2xl transition-all shadow-lg hover:shadow-cyan-500/10"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="p-3 bg-cyan-950/80 border border-cyan-800/50 rounded-xl text-cyan-400 group-hover:scale-110 transition-transform">
                <Sliders className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white group-hover:text-cyan-300 transition-colors">
                  Control Panel
                </h3>
                <span className="text-xs text-slate-500 font-mono">/control</span>
              </div>
            </div>
            <p className="text-sm text-slate-400 leading-normal">
              Live microphone transcription, crowd size slider, moment depth, manual triggers, and AI telemetry.
            </p>
          </Link>

          <Link
            href="/overlay"
            className="group relative p-6 bg-zinc-900/80 hover:bg-zinc-800/80 border border-zinc-800 hover:border-purple-500/50 rounded-2xl transition-all shadow-lg hover:shadow-purple-500/10"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="p-3 bg-purple-950/80 border border-purple-800/50 rounded-xl text-purple-400 group-hover:scale-110 transition-transform">
                <Monitor className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white group-hover:text-purple-300 transition-colors">
                  OBS Stream Overlay
                </h3>
                <span className="text-xs text-slate-500 font-mono">/overlay</span>
              </div>
            </div>
            <p className="text-sm text-slate-400 leading-normal">
              100% transparent browser source overlay. Auto-reconnecting GraphQL subscription with smooth chat animations.
            </p>
          </Link>
        </div>

        <div className="pt-6 border-t border-zinc-900 text-xs text-zinc-500 flex items-center justify-center gap-6">
          <span className="flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-emerald-400" />
            GraphQL Subscriptions Active
          </span>
          <span className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
            Groq · Gemini · OpenRouter
          </span>
        </div>
      </div>
    </main>
  );
}
