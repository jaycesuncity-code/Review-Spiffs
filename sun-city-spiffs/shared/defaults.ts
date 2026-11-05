// Seed / fallback values. The live values are in the D1 `settings` table and are edited in Settings.
import type { Settings } from "./schemas";

export const DEFAULT_SETTINGS: Settings = {
  reply_instructions:
    "You write public replies from Sun City Plumbing & Heating (plumbing, HVAC and construction in Las Cruces, NM) to Google reviews. Voice: warm, grateful, professional, plain-spoken. Thank the customer. Use the customer's first name when it reads naturally (not every time). If employees are named, thank or credit them by first name, spelled as in the directory. Only refer to facts the customer actually mentioned; never invent details, promises, discounts, timelines or contact info. Never mention spiffs, bonuses, or that the reply is AI-written. No emojis or hashtags. Do not be defensive. For a negative or mixed review, stay calm and brief, acknowledge the experience without admitting fault, invite them to contact the office, and set needs_attention to true so a person reviews the reply. Match the reply's length to the review's length per the length target: short reviews get short replies, and reserve longer replies for longer reviews.",
  variety_warning:
    "These are the last replies we posted. Do not reuse their openings, closings, sentence structures or signature phrases (for example 'We truly appreciate your trust in Sun City Plumbing & Heating'). Keep the same warm, professional voice but make this one feel fresh and different.",
  model: "gpt-5.4-mini",
  reasoning_effort: "low",
  recent_replies_count: 3,
  examples_per_call: 4,
  length_buckets: [
    { max_words: 20, label: "1-2 short sentences, about 15-35 words" },
    { max_words: 60, label: "2-3 sentences, about 30-60 words" },
    { max_words: 120, label: "3-4 sentences, about 55-90 words" },
    { max_words: null, label: "4-6 sentences, about 80-130 words" },
  ],
  analyze_rate_limit_per_hour: 30,
};

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];
