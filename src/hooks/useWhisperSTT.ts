"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export interface UseWhisperSTTOptions {
  onTranscript?: (text: string) => void;
  onError?: (err: string) => void;
}

export function useWhisperSTT(options: UseWhisperSTTOptions = {}) {
  const [isListening, setIsListening] = useState<boolean>(false);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [permissionStatus, setPermissionStatus] = useState<"granted" | "prompt" | "denied" | "unknown">("unknown");
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const audioChunksRef = useRef<Blob[]>([]);
  const isListeningRef = useRef<boolean>(false);

  // Check initial permission state
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "microphone" as PermissionName })
        .then((res) => {
          setPermissionStatus(res.state as any);
          res.onchange = () => setPermissionStatus(res.state as any);
        })
        .catch(() => {});
    }
  }, []);

  const sendAudioChunk = useCallback(async (blob: Blob) => {
    if (blob.size < 4000) return; // Ignore very small/silent chunks

    try {
      setIsProcessing(true);
      const formData = new FormData();
      formData.append("file", blob, "chunk.webm");

      const res = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.warn("[Whisper STT] Transcribe error:", data.error || res.statusText);
        return;
      }

      const data = await res.json();
      if (data.text) {
        console.log("[Whisper STT] Recognized text:", data.text);
        optionsRef.current.onTranscript?.(data.text);
      }
    } catch (e: any) {
      console.warn("[Whisper STT] Request failed:", e.message);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const stopListening = useCallback(() => {
    isListeningRef.current = false;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
      mediaRecorderRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    setAudioLevel(0);
    setIsListening(false);
    setIsProcessing(false);
  }, []);

  const startListening = useCallback(async () => {
    setError(null);

    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      const err = "Your browser does not support microphone audio capture. Please use a modern browser (Chrome, Edge, Safari, Firefox).";
      setError(err);
      return;
    }

    try {
      // 1. Request microphone hardware access
      console.log("[Whisper STT] Requesting getUserMedia...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;
      setPermissionStatus("granted");
      isListeningRef.current = true;
      setIsListening(true);

      // 2. Setup AudioContext for real-time visual meter
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const updateLevel = () => {
          if (!isListeningRef.current) return;
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          const normalized = Math.min(100, Math.round((avg / 128) * 100));
          setAudioLevel(normalized);
          animFrameRef.current = requestAnimationFrame(updateLevel);
        };
        updateLevel();
      }

      // 3. Setup MediaRecorder for streaming to Groq Whisper
      const mimeTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
        "",
      ];
      let selectedMime = "";
      for (const mime of mimeTypes) {
        if (!mime || MediaRecorder.isTypeSupported(mime)) {
          selectedMime = mime;
          break;
        }
      }

      const recorder = selectedMime
        ? new MediaRecorder(stream, { mimeType: selectedMime })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          // If we have collected enough audio chunks (~2.5s slice), package and send to Whisper
          if (audioChunksRef.current.length >= 1) {
            const combinedBlob = new Blob(audioChunksRef.current, {
              type: selectedMime || "audio/webm",
            });
            audioChunksRef.current = [];
            sendAudioChunk(combinedBlob);
          }
        }
      };

      // Slice audio every 2500ms for fast real-time transcription
      recorder.start(2500);
      console.log("[Whisper STT] MediaRecorder started successfully");
    } catch (err: any) {
      console.error("[Whisper STT] getUserMedia failed:", err);
      let msg = "Microphone access failed.";
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setPermissionStatus("denied");
        msg =
          "Microphone permission was DENIED. (1) Click the tune/lock icon in your address bar and set Microphone to 'Allow'. (2) On Mac, open System Settings > Privacy & Security > Microphone and ensure your browser is toggled ON.";
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        msg = "No microphone hardware found on your computer.";
      }
      setError(msg);
      optionsRef.current.onError?.(msg);
      stopListening();
    }
  }, [sendAudioChunk, stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  return {
    isListening,
    audioLevel,
    permissionStatus,
    error,
    isProcessing,
    startListening,
    stopListening,
  };
}
