export interface PersonaProfile {
  id: string;
  name: string; // username
  color: string;
  age_group: string;
  vibe: string;
  slang_style: string;
  typing_style: string;
  emoji_rate: number;
  caps_rate: number;
  reaction_bias: string;
  catchphrases: string[];
  energy: number;
  created_at: number;
}

export interface ChatMessageItem {
  id: string;
  personaId: string;
  username: string;
  color: string;
  text: string;
  kind: string;
  ts: number;
}

export interface SettingsState {
  botCount: number;
  momentDepth: number; // 0-10
  speedMultiplier: number;
  enabled: boolean;
  ambientChatter: boolean;
  aiLabel: boolean;
}
