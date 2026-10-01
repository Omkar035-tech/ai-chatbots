import { personaStore } from "../personas/store";
import { chatHumanizer } from "./humanizer";
import { chatScheduler } from "./scheduler";

export interface CallbackItem {
  tag: string;
  momentId: string;
  scheduledReleaseTs: number;
}

export class CallbackManager {
  private activeTimers: Set<NodeJS.Timeout> = new Set();
  private recentTags: Set<string> = new Set();

  /**
   * Schedules delayed callbacks for a pinned moment with joke tags or entities.
   * Released 20s to 5 minutes later at low intensity from different personas.
   */
  public scheduleCallbacksForMoment(
    momentId: string,
    tags: string[],
    speedMultiplier: number = 1.0
  ) {
    if (!tags || tags.length === 0) return;

    for (const tag of tags) {
      if (this.recentTags.has(tag.toLowerCase())) continue;
      this.recentTags.add(tag.toLowerCase());
      if (this.recentTags.size > 50) {
        const first = this.recentTags.values().next().value;
        if (first) this.recentTags.delete(first);
      }

      // Schedule 1 to 3 delayed callback lines spaced 20s to 180s apart
      const count = Math.floor(Math.random() * 2) + 1;
      for (let i = 0; i < count; i++) {
        const delaySec = Math.floor(Math.random() * 120) + 25 + i * 40;
        const adjustedDelayMs = Math.round((delaySec * 1000) / Math.max(0.1, speedMultiplier));

        const timer = setTimeout(async () => {
          this.activeTimers.delete(timer);
          await this.releaseCallback(tag, momentId);
        }, adjustedDelayMs);

        this.activeTimers.add(timer);
      }
    }
  }

  private async releaseCallback(tag: string, momentId: string) {
    try {
      const personas = await personaStore.getActivePersonas();
      if (personas.length === 0) return;

      const persona = personas[Math.floor(Math.random() * personas.length)];
      const templates = [
        `still thinking about ${tag} lol`,
        `${tag} update?`,
        `how's ${tag} doing`,
        `wait whatever happened with ${tag}`,
        `can't get over ${tag}`,
        `is ${tag} okay tho`,
      ];

      const raw = templates[Math.floor(Math.random() * templates.length)];
      const humanized = chatHumanizer.humanizeMessage(raw, persona, 3);

      if (humanized.accepted) {
        chatScheduler.scheduleBatch(
          [
            {
              personaId: persona.id,
              username: persona.name,
              color: persona.color,
              text: humanized.text,
              kind: "callback",
            },
          ],
          3,
          1.0
        );
      }
    } catch (err: any) {
      console.warn("[CallbackManager] Failed to release callback:", err.message);
    }
  }

  public clear() {
    for (const t of this.activeTimers) {
      clearTimeout(t);
    }
    this.activeTimers.clear();
  }
}

export const callbackManager = new CallbackManager();
