import { NextRequest, NextResponse } from "next/server";
import { config } from "@/server/config";
import { serverSTT } from "@/server/stt";
import { pubSub } from "@/graphql/pubsub";

export async function POST(req: NextRequest) {
  try {
    const apiKey = config.groq.apiKey;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GROQ_API_KEY is not configured on the server" },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Missing audio file in form data" },
        { status: 400 }
      );
    }

    // Forward to Groq Whisper Large V3 Turbo
    const groqFormData = new FormData();
    groqFormData.append("file", file, "audio.webm");
    groqFormData.append("model", "whisper-large-v3-turbo");
    groqFormData.append("language", "en");
    groqFormData.append("temperature", "0.2");

    const whisperResponse = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: groqFormData,
    });

    if (!whisperResponse.ok) {
      const errorText = await whisperResponse.text().catch(() => "");
      console.warn("[Groq Whisper] Error:", whisperResponse.status, errorText);
      return NextResponse.json(
        { error: `Groq Whisper error [${whisperResponse.status}]: ${errorText.slice(0, 200)}` },
        { status: whisperResponse.status }
      );
    }

    const data = await whisperResponse.json();
    const rawText = (data?.text || "").trim();

    // Filter out common Whisper hallucination / silence artifacts like "(music)", "Thank you.", etc.
    const cleanText = rawText
      .replace(/^[\s\.\,\!\?]+|[\s\.\,\!\?]+$/g, "")
      .replace(/\s+/g, " ");

    const isHallucination =
      !cleanText ||
      /^(thank you|thanks for watching|you|bye|subtitles by|copyright|music|\.)$/i.test(cleanText);

    if (cleanText && !isHallucination) {
      console.log(`[Groq Whisper] Transcribed: "${cleanText}"`);
      // Submit transcript into CrowdChat server STT pipeline
      serverSTT.emitTranscript(cleanText, true);
      pubSub.publish("transcript", cleanText);
      return NextResponse.json({ success: true, text: cleanText });
    }

    return NextResponse.json({ success: true, text: "", skipped: true });
  } catch (err: any) {
    console.error("[Transcribe API] Unexpected error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal transcription error" },
      { status: 500 }
    );
  }
}
