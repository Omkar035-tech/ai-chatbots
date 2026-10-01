import { ChatMessageItem } from "../personas/types";
import { personaStore } from "../personas/store";

export type MessagePublishCallback = (message: ChatMessageItem) => void;

interface ScheduledItem {
  message: ChatMessageItem;
  releaseTime: number;
  timerId: NodeJS.Timeout;
}

export class ChatScheduler {
  private activeTimers: Set<NodeJS.Timeout> = new Set();
  private lastPersonaPostTs: Map<string, number> = new Map();
  private onPublishCallback: MessagePublishCallback | null = null;

  public setOnPublish(cb: MessagePublishCallback) {
    this.onPublishCallback = cb;
  }

  public scheduleBatch(
    messages: { personaId: string; username: string; color: string; text: string; kind: string }[],
    intensity: number,
    speedMultiplier: number = 1.0
  ): void {
    if (messages.length === 0) return;

    // Initial human-like reaction delay before the first message appears
    let baseInitialDelayMs =
      intensity >= 8
        ? Math.floor(Math.random() * 600) + 400 // 400 - 1000 ms
        : intensity >= 4
        ? Math.floor(Math.random() * 1000) + 800 // 800 - 1800 ms
        : Math.floor(Math.random() * 1500) + 1200; // 1200 - 2700 ms

    let accumulatedDelayMs = Math.round(baseInitialDelayMs * Math.max(0.1, speedMultiplier));

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      // Delay between consecutive messages in the burst
      let intervalMs: number;
      if (intensity >= 8) {
        // High intensity burst: 150 - 900 ms
        intervalMs = Math.floor(Math.random() * 750) + 150;
      } else if (intensity >= 4) {
        // Medium intensity: 800 - 3000 ms
        intervalMs = Math.floor(Math.random() * 2200) + 800;
      } else {
        // Low intensity: 3000 - 9000 ms
        intervalMs = Math.floor(Math.random() * 6000) + 3000;
      }

      // Add jitter (+/- 20%)
      const jitter = (Math.random() * 0.4 - 0.2) * intervalMs;
      const actualInterval = Math.max(100, Math.round((intervalMs + jitter) * Math.max(0.1, speedMultiplier)));

      if (i > 0) {
        accumulatedDelayMs += actualInterval;
      }

      // Ensure at least 2s spacing for the same persona unless intensity >= 8
      if (intensity < 8) {
        const lastPost = this.lastPersonaPostTs.get(msg.personaId) || 0;
        const projectedRelease = Date.now() + accumulatedDelayMs;
        if (projectedRelease - lastPost < 2000) {
          accumulatedDelayMs += 2000;
        }
      }

      const releaseDelay = accumulatedDelayMs;
      const chatItem: ChatMessageItem = {
        id: `msg_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 7)}`,
        personaId: msg.personaId,
        username: msg.username,
        color: msg.color,
        text: msg.text,
        kind: msg.kind,
        ts: Date.now() + releaseDelay,
      };

      const timer = setTimeout(async () => {
        this.activeTimers.delete(timer);
        this.lastPersonaPostTs.set(chatItem.personaId, Date.now());
        // Save to Redis recent chat and persona history
        await personaStore.addChatMessage(chatItem);
        // Publish to subscribers
        this.onPublishCallback?.(chatItem);
      }, releaseDelay);

      this.activeTimers.add(timer);
    }
  }

  public clearPending(): void {
    for (const t of this.activeTimers) {
      clearTimeout(t);
    }
    this.activeTimers.clear();
  }
}

export const chatScheduler = new ChatScheduler();
