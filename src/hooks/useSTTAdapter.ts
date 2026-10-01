"use client";

import { useState, useRef, useCallback } from "react";
import { useSpeechRecognition } from "./useSpeechRecognition";
import { useWhisperSTT } from "./useWhisperSTT";

export interface TranscriptEvent {
  text: string;
  is_final: boolean;
  timestamp: number;
}

export interface UseSTTAdapterOptions {
  onTranscriptEvent?: (event: TranscriptEvent) => void;
  lang?: string;
  defaultEngine?: "whisper" | "webspeech";
}

export function useSTTAdapter(options: UseSTTAdapterOptions = {}) {
  const [engine, setEngine] = useState<"whisper" | "webspeech">(options.defaultEngine ?? "whisper");
  const onTranscriptEventRef = useRef(options.onTranscriptEvent);
  onTranscriptEventRef.current = options.onTranscriptEvent;

  const handleResult = useCallback((text: string, isFinal: boolean) => {
    if (!text || !text.trim()) return;
    const event: TranscriptEvent = {
      text: text.trim(),
      is_final: isFinal,
      timestamp: Date.now(),
    };
    onTranscriptEventRef.current?.(event);
  }, []);

  // Engine 1: Groq Whisper Turbo (High-accuracy cloud audio streaming, works on ALL browsers)
  const whisper = useWhisperSTT({
    onTranscript: (text) => handleResult(text, true),
  });

  // Engine 2: Web Speech API (Client-side browser speech recognition)
  const webSpeech = useSpeechRecognition({
    continuous: true,
    interimResults: true,
    lang: options.lang ?? "en-US",
    onResult: handleResult,
  });

  const activeSTT = engine === "whisper" ? whisper : webSpeech;

  const startListening = useCallback(async () => {
    if (engine === "whisper") {
      await whisper.startListening();
    } else {
      await webSpeech.startListening();
    }
  }, [engine, whisper, webSpeech]);

  const stopListening = useCallback(() => {
    if (engine === "whisper") {
      whisper.stopListening();
    } else {
      webSpeech.stopListening();
    }
  }, [engine, whisper, webSpeech]);

  return {
    engine,
    setEngine,
    isListening: activeSTT.isListening,
    audioLevel: activeSTT.audioLevel,
    permissionStatus: activeSTT.permissionStatus,
    error: activeSTT.error,
    isProcessing: (whisper as any).isProcessing ?? false,
    startListening,
    stopListening,
  };
}
