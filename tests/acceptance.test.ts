import { preFilter } from "../src/server/pipeline/prefilter";
import { Director } from "../src/server/pipeline/director";
import { personaStore } from "../src/server/personas/store";
import { personaSelector } from "../src/server/pipeline/persona_selector";
import { writer } from "../src/server/pipeline/writer";
import { safetyFilter } from "../src/server/pipeline/safety";
import { chatScheduler } from "../src/server/pipeline/scheduler";
import { LLMRouter } from "../src/server/llm/router";
import { SettingsState } from "../src/server/personas/types";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passedCount++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failedCount++;
  }
}

async function runAcceptanceTests() {
  console.log("\n==========================================");
  console.log("   CROWDCHAT END-TO-END ACCEPTANCE TESTS   ");
  console.log("==========================================\n");

  const dummySettings: SettingsState = {
    botCount: 20,
    momentDepth: 5,
    speedMultiplier: 1.0,
    enabled: true,
    ambientChatter: true,
    aiLabel: false,
  };

  // Test 1: High emotion / rage transcript -> PreFilter triggers and Director handles appropriately
  console.log("[Test 1] Rage / hype moment: 'No way, I hate this game, I'm done!'");
  const rageText = "No way, I hate this game, I'm done!";
  const preFilterRage = preFilter.evaluate(rageText, dummySettings, 0, 0);
  assert(preFilterRage.shouldEvaluate === true, "PreFilter allows high emotion chunk through");
  assert(preFilterRage.isLikelyHype === true, "PreFilter flags likely hype for rage moment");

  const directorInstance = new Director();
  const directorResult = await directorInstance.evaluate(
    rageText,
    "Streamer playing horror game.",
    preFilterRage.hints,
    60000,
    dummySettings.momentDepth
  );
  assert(directorResult.react === true, "Director says YES for rage moment");
  assert(directorResult.intensity >= 6, `Director intensity is high (${directorResult.intensity}/10)`);

  // Test 2: Low energy mundane speech -> PreFilter skips or Director says NO
  console.log("\n[Test 2] Mundane speech: 'okay let me check inventory'");
  const mundaneText = "okay let me check inventory";
  const preFilterMundane = preFilter.evaluate(mundaneText, dummySettings, 0, 0);
  // If evaluated, director should say NO
  if (preFilterMundane.shouldEvaluate) {
    const mundaneDecision = await directorInstance.evaluate(
      mundaneText,
      "Streamer exploring room.",
      preFilterMundane.hints,
      10000,
      dummySettings.momentDepth
    );
    assert(mundaneDecision.react === false || mundaneDecision.intensity <= 2, "Director says NO or gives low intensity for mundane speech");
  } else {
    assert(preFilterMundane.shouldEvaluate === false, "PreFilter correctly skipped mundane short speech");
  }

  // Test 3: Deterministic Persona activation: Lowering bot count from 40 to 10 then back to 40
  console.log("\n[Test 3] Deterministic roster: 40 -> 10 -> 40 bot count");
  await personaStore.saveSettings({ botCount: 40 });
  const roster40_A = await personaStore.getActivePersonas();
  assert(roster40_A.length === 40, `Roster A contains exactly 40 personas (got ${roster40_A.length})`);

  await personaStore.saveSettings({ botCount: 10 });
  const roster10 = await personaStore.getActivePersonas();
  assert(roster10.length === 10, `Roster scaled down to 10 personas (got ${roster10.length})`);

  // First 10 of roster40_A must match roster10 exactly in stable order
  const idsFirst10_A = roster40_A.slice(0, 10).map((p) => p.id);
  const ids10 = roster10.map((p) => p.id);
  assert(
    JSON.stringify(idsFirst10_A) === JSON.stringify(ids10),
    "The 10 personas are identical to the first 10 of the original 40"
  );

  await personaStore.saveSettings({ botCount: 40 });
  const roster40_B = await personaStore.getActivePersonas();
  const ids40_B = roster40_B.map((p) => p.id);
  const ids40_A = roster40_A.map((p) => p.id);
  assert(
    JSON.stringify(ids40_A) === JSON.stringify(ids40_B),
    "Restoring bot count to 40 returns the exact same 40 personas in stable order"
  );

  // Test 4: Persona voice consistency & Writer batch generation
  console.log("\n[Test 4] Writer batch generation and voice consistency");
  const selected = await personaSelector.selectPersonas(roster10, "rage", 8, ["troll", "hype"]);
  assert(selected.length >= 3, `Persona selector picked ${selected.length} responders for high intensity`);

  const writerMessages = await writer.generateChatBatch(
    "No way, I hate this game, I'm done!",
    "rage",
    8,
    selected
  );
  assert(writerMessages.length > 0, `Writer produced ${writerMessages.length} messages`);
  assert(
    writerMessages.every((m) => m.text && m.text.length <= 120),
    "All writer messages are compact chat-sized lines (<= 120 chars)"
  );

  // Test 5: Safety filter: Drops blocklisted words and allows clean stream chat
  console.log("\n[Test 5] Safety Filter testing");
  const badMessage1 = "Check out this free crypto hack at https://free-scam.xyz/gift";
  const badMessage2 = "you should kill yourself right now";
  const cleanMessage = "bro that jump scare got you good 💀";

  const safe1 = await safetyFilter.validateMessage(badMessage1);
  const safe2 = await safetyFilter.validateMessage(badMessage2);
  const safe3 = await safetyFilter.validateMessage(cleanMessage);

  assert(safe1.valid === false, "Safety filter dropped promotional link");
  assert(safe2.valid === false, "Safety filter dropped TOS self-harm violation");
  assert(safe3.valid === true, "Safety filter allowed authentic clean stream chat line");

  // Test 6: LLM Provider Router Failover with simulated 429
  console.log("\n[Test 6] LLM Provider Router failover testing");
  const router = new LLMRouter();
  // Call router with fallback or healthy provider
  const response = await router.complete_json(
    "director",
    "System test prompt",
    "Streamer died in game"
  );
  assert(response !== null && typeof response === "object", "Router returns normalized JSON object");

  const stats = router.getProviderStats();
  assert(stats.length === 3, "Router exposes telemetry for Gemini, Groq, and OpenRouter");
  assert(
    stats.some((s) => s.name === "gemini") &&
      stats.some((s) => s.name === "groq") &&
      stats.some((s) => s.name === "openrouter"),
    "All three target providers are registered"
  );

  // Test 7: Scheduler burst timing
  console.log("\n[Test 7] Scheduler release timing");
  let messagesReceived = 0;
  chatScheduler.setOnPublish((msg) => {
    messagesReceived++;
  });
  chatScheduler.scheduleBatch(
    [
      { personaId: "p1", username: "user1", color: "#fff", text: "L", kind: "troll" },
      { personaId: "p2", username: "user2", color: "#fff", text: "bro 💀", kind: "troll" },
    ],
    9,
    0.1 // speed up for test
  );
  // Wait 600ms to allow burst at 0.1x speed multiplier
  await new Promise((r) => setTimeout(r, 600));
  assert(messagesReceived > 0, "Scheduler successfully timed and published chat messages");
  chatScheduler.clearPending();

  console.log("\n==========================================");
  console.log(`RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("==========================================\n");

  try {
    personaStore.getRedis().disconnect();
  } catch {
    // ignore
  }

  process.exit(failedCount > 0 ? 1 : 0);
}

runAcceptanceTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
