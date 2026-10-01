export const typeDefs = /* GraphQL */ `
  type Persona {
    id: ID!
    username: String!
    color: String!
    ageGroup: String!
    vibe: String!
    energy: Int!
  }

  type ChatMessage {
    id: ID!
    personaId: ID!
    username: String!
    color: String!
    text: String!
    kind: String!
    ts: Float!
  }

  type DirectorDecision {
    react: Boolean!
    eventType: String!
    intensity: Int!
    reason: String!
    ts: Float!
  }

  type ProviderStat {
    name: String!
    healthy: Boolean!
    cooldownUntil: Float
    callsPerMin: Int!
    active: Boolean!
  }

  type SignalBreakdown {
    name: String!
    value: Float!
    weight: Float!
    contribution: Float!
  }

  type HypeTelemetry {
    score: Float!
    state: String!
    signals: [SignalBreakdown!]!
    momentQuote: String
    eventType: String
    intensity: Int
    tierUsed: String
    bankTotalCount: Int!
    bankUnusedCount: Int!
    batchCyclesLastHour: Int!
    reactiveCallsLastHour: Int!
    totalApiCallsLastHour: Int!
    blockedRequestsCount: Int!
    ts: Float!
  }

  type Settings {
    botCount: Int!
    momentDepth: Int!
    speedMultiplier: Float!
    enabled: Boolean!
    ambientChatter: Boolean!
    aiLabel: Boolean!
  }

  input SettingsInput {
    botCount: Int
    momentDepth: Int
    speedMultiplier: Float
    enabled: Boolean
    ambientChatter: Boolean
    aiLabel: Boolean
  }

  type Query {
    settings: Settings!
    activePersonas: [Persona!]!
    providerStats: [ProviderStat!]!
    recentChat(limit: Int = 25): [ChatMessage!]!
    hypeTelemetry: HypeTelemetry!
  }

  type Mutation {
    updateSettings(input: SettingsInput!): Settings!
    submitTranscript(text: String!, isFinal: Boolean!): Boolean!
    triggerReaction(kind: String!, text: String): Boolean!
    clearChat: Boolean!
  }

  type Subscription {
    chatMessage: ChatMessage!
    transcript: String!
    directorDecision: DirectorDecision!
    rosterUpdated: [Persona!]!
    providerStats: [ProviderStat!]!
    hypeTelemetry: HypeTelemetry!
  }
`;
