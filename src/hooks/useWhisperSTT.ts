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

  const isListeningRef = useRef<boolean>(false);
  const isRecordingPhraseRef = useRef<boolean>(false);
  const speechStartTimeRef = useRef<number>(0);
  const lastSpeechTimeRef = useRef<number>(0);
  const selectedMimeRef = useRef<string>("");
  const audioChunksRef = useRef<Blob[]>([]);

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
    if (blob.size < 1500) return; // Ignore very small / accidental clicks

    try {
      setIsProcessing(true);
      const formData = new FormData();
      formData.append("file", blob, "phrase.webm");

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
      if (data.text && data.text.trim()) {
        console.log("[Whisper STT] Recognized phrase:", data.text);
        optionsRef.current.onTranscript?.(data.text);
      }
    } catch (e: any) {
      console.warn("[Whisper STT] Request failed:", e.message);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const startPhraseRecording = useCallback(() => {
    if (!mediaStreamRef.current || !isListeningRef.current || isRecordingPhraseRef.current) return;

    try {
      const stream = mediaStreamRef.current;
      const mime = selectedMimeRef.current;
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      isRecordingPhraseRef.current = true;
      speechStartTimeRef.current = Date.now();
      lastSpeechTimeRef.current = Date.now();

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        isRecordingPhraseRef.current = false;
        if (audioChunksRef.current.length > 0) {
          const finalBlob = new Blob(audioChunksRef.current, {
            type: mime || "audio/webm",
          });
          audioChunksRef.current = [];
          sendAudioChunk(finalBlob);
        }
      };

      recorder.start();
    } catch (err: any) {
      console.warn("[Whisper STT] Failed to start phrase recorder:", err);
      isRecordingPhraseRef.current = false;
    }
  }, [sendAudioChunk]);

  const stopPhraseRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    isRecordingPhraseRef.current = false;
  }, []);

  const stopListening = useCallback(() => {
    isListeningRef.current = false;
    stopPhraseRecording();

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
  }, [stopPhraseRecording]);

  const startListening = useCallback(async () => {
    setError(null);

    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      const err = "Your browser does not support microphone audio capture. Please use a modern browser (Chrome, Edge, Safari, Firefox).";
      setError(err);
      return;
    }

    try {
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

      // Detect supported mime type once
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
      selectedMimeRef.current = selectedMime;

      // Setup Web Audio API Analyser for real-time visual meter and VAD
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const checkAudio = () => {
          if (!isListeningRef.current) return;
          analyser.getByteFrequencyData(dataArray);

          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          const normalized = Math.min(100, Math.round((avg / 128) * 100));
          setAudioLevel(normalized);

          const now = Date.now();
          const SPEECH_THRESHOLD = 7;
          const PAUSE_THRESHOLD_MS = 650;
          const MAX_PHRASE_MS = 4000;

          if (normalized >= SPEECH_THRESHOLD) {
            // Voice active
            if (!isRecordingPhraseRef.current) {
              startPhraseRecording();
            } else {
              lastSpeechTimeRef.current = now;
              // Check if phrase has reached max duration (4 seconds)
              if (now - speechStartTimeRef.current >= MAX_PHRASE_MS) {
                stopPhraseRecording();
              }
            }
          } else {
            // Silence / below threshold
            if (isRecordingPhraseRef.current) {
              if (now - lastSpeechTimeRef.current >= PAUSE_THRESHOLD_MS) {
                // Streamer paused after talking -> send phrase to Whisper
                stopPhraseRecording();
              }
            }
          }

          animFrameRef.current = requestAnimationFrame(checkAudio);
        };

        checkAudio();
      }
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
  }, [startPhraseRecording, stopPhraseRecording, stopListening]);

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
