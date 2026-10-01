"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface SpeechRecognitionOptions {
  continuous?: boolean;
  interimResults?: boolean;
  lang?: string;
  onResult?: (text: string, isFinal: boolean) => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
}

export type PermissionState = "granted" | "prompt" | "denied" | "unknown";

export interface UseSpeechRecognitionReturn {
  isListening: boolean;
  isSupported: boolean;
  permissionStatus: PermissionState;
  transcript: string;
  interimTranscript: string;
  error: string | null;
  audioLevel: number;
  startListening: () => Promise<void>;
  stopListening: () => void;
  resetTranscript: () => void;
}

export function useSpeechRecognition(
  options: SpeechRecognitionOptions = {}
): UseSpeechRecognitionReturn {
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [permissionStatus, setPermissionStatus] = useState<PermissionState>("unknown");
  const [transcript, setTranscript] = useState<string>("");
  const [interimTranscript, setInterimTranscript] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState<number>(0);

  const recognitionRef = useRef<any>(null);
  const shouldListenRef = useRef<boolean>(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Check browser support and permission state on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setIsSupported(false);
      setError(
        "Web Speech API is not supported in this browser. Please open in Google Chrome or Microsoft Edge."
      );
    }

    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions
        .query({ name: "microphone" as PermissionName })
        .then((res) => {
          setPermissionStatus(res.state as PermissionState);
          res.onchange = () => {
            setPermissionStatus(res.state as PermissionState);
          };
        })
        .catch(() => {
          // Some browsers throw on 'microphone' permission query
        });
    }
  }, []);

  const createRecognitionInstance = useCallback(() => {
    if (typeof window === "undefined") return null;

    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setIsSupported(false);
      return null;
    }

    try {
      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = optionsRef.current.continuous ?? true;
      recognition.interimResults = optionsRef.current.interimResults ?? true;
      recognition.lang = optionsRef.current.lang ?? "en-US";

      recognition.onstart = () => {
        console.log("[STT] SpeechRecognition session started");
        setIsListening(true);
        setError(null);
      };

      recognition.onresult = (event: any) => {
        let finalTxt = "";
        let interimTxt = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          if (res.isFinal) {
            finalTxt += res[0].transcript;
          } else {
            interimTxt += res[0].transcript;
          }
        }

        if (finalTxt) {
          const trimmedFinal = finalTxt.trim();
          console.log("[STT] Captured final text:", trimmedFinal);
          setTranscript(trimmedFinal);
          optionsRef.current.onResult?.(trimmedFinal, true);
          setInterimTranscript("");
        } else if (interimTxt) {
          const trimmedInterim = interimTxt.trim();
          setInterimTranscript(trimmedInterim);
          optionsRef.current.onResult?.(trimmedInterim, false);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn("[STT] Recognition error:", event.error);

        // 'no-speech' happens naturally during pauses; do not stop continuous listening
        if (event.error === "no-speech") {
          return;
        }

        let errorMsg = `Speech recognition error: ${event.error}`;
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          setPermissionStatus("denied");
          errorMsg =
            "Microphone access blocked. Click the lock/tune icon on the left of your URL bar (https:// or http://localhost:3002) and change Microphone to 'Allow'.";
        } else if (event.error === "network") {
          errorMsg = "Speech recognition network error. Ensure your internet connection is active.";
        }

        setError(errorMsg);
        optionsRef.current.onError?.(errorMsg);
      };

      recognition.onend = () => {
        console.log("[STT] Recognition session ended. Active:", shouldListenRef.current);

        // Auto-restart if continuous mode is active
        if (shouldListenRef.current) {
          try {
            const next = createRecognitionInstance();
            if (next) {
              recognitionRef.current = next;
              next.start();
              return;
            }
          } catch (err: any) {
            console.warn("[STT] Restart error:", err?.message);
          }
        }

        setIsListening(false);
        optionsRef.current.onEnd?.();
      };

      return recognition;
    } catch (err: any) {
      console.error("[STT] Failed to create SpeechRecognition:", err);
      return null;
    }
  }, []);

  const stopListening = useCallback(() => {
    shouldListenRef.current = false;

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    setAudioLevel(0);

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }

    setIsListening(false);
  }, []);

  const startListening = useCallback(async () => {
    setError(null);
    setInterimTranscript("");
    shouldListenRef.current = true;

    // 0. Ensure secure context (required by browsers for mic & speech recognition)
    if (typeof window !== "undefined" && !window.isSecureContext) {
      const msg =
        "Insecure context: Microphone and Speech Recognition require 'http://localhost:3002' or HTTPS. Please open http://localhost:3002 directly.";
      setError(msg);
      shouldListenRef.current = false;
      return;
    }

    // 1. Query permissions if API is present (with 500ms safety timeout)
    if (typeof navigator !== "undefined" && navigator.permissions?.query) {
      try {
        const queryPromise = navigator.permissions.query({ name: "microphone" as PermissionName });
        const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 500));
        const queryRes: any = await Promise.race([queryPromise, timeoutPromise]);
        if (queryRes) {
          setPermissionStatus(queryRes.state as PermissionState);
          if (queryRes.state === "denied") {
            const msg =
              "Microphone is currently BLOCKED in browser settings. Please click the lock/settings icon in the address bar (left of the URL) and change Microphone to 'Allow', then click 'Start Mic' again.";
            setError(msg);
            shouldListenRef.current = false;
            return;
          }
        }
      } catch {
        // query not supported on all browsers (e.g. Safari)
      }
    }

    // 2. Request microphone stream via getUserMedia & connect audio level meter
    if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        setPermissionStatus("granted");

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          audioContextRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const updateAudioLevel = () => {
            if (!shouldListenRef.current) return;
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const avg = sum / dataArray.length;
            const normalized = Math.min(100, Math.round((avg / 128) * 100));
            setAudioLevel(normalized);
            animFrameRef.current = requestAnimationFrame(updateAudioLevel);
          };
          updateAudioLevel();
        }
      } catch (err: any) {
        console.warn("[STT] getUserMedia error:", err);
        let msg = "Microphone access request was not completed.";
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          setPermissionStatus("denied");
          msg =
            "Microphone permission was DENIED. (1) In Chrome address bar, click the site settings/lock icon next to http://localhost:3002 and switch Microphone to 'Allow'. (2) On Mac, open System Settings > Privacy & Security > Microphone and ensure Google Chrome is toggled ON.";
        } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          msg = "No audio input device (microphone) was found on your system.";
        }
        setError(msg);
        shouldListenRef.current = false;
        optionsRef.current.onError?.(msg);
        return;
      }
    }

    // 3. Initialize and start Web Speech Recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
    }

    const rec = createRecognitionInstance();
    if (!rec) {
      setIsListening(true); // Mic audio stream is active even if Web Speech is missing
      setError(
        "Web Speech API is not supported in this browser. Please open in Google Chrome or Microsoft Edge for automatic voice transcription."
      );
      return;
    }

    recognitionRef.current = rec;

    try {
      rec.start();
      setIsListening(true);
    } catch (e: any) {
      console.warn("[STT] rec.start() error:", e);
      setIsListening(true); // Keep media stream listening active
    }
  }, [createRecognitionInstance]);

  const resetTranscript = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      shouldListenRef.current = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => {});
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  return {
    isListening,
    isSupported,
    permissionStatus,
    transcript,
    interimTranscript,
    error,
    audioLevel,
    startListening,
    stopListening,
    resetTranscript,
  };
}
