import type { RawExtraction } from "../types/trade";

/** Direct browser -> Anthropic call, same pattern as the Job Tracker app
 * (anthropic-dangerous-direct-browser-access header, user-supplied key). */
const SYSTEM_PROMPT = `You extract structured player/pick movements from informal fantasy football trade announcements posted in a group chat. The messages are inconsistent in phrasing — different verbs ("Trades", "sends"), different layouts (single line vs. multi-line lists), and sometimes a trade's assets are split across more than one sentence/line without repeating who they're going to.

Output ONLY a JSON object of this exact shape, no markdown fences, no commentary:
{"movements": [{"from": "<team mention as written>", "to": "<team mention as written>", "asset": {"type": "player", "name": "<player name as written>"} | {"type": "pick", "round": <int>, "year": <int or null>, "raw_text": "<the original phrase>"}}]}

Rules:
- Preserve team names/nicknames exactly as written in the message (do not normalize casing or expand abbreviations) — resolving them to real teams happens elsewhere.
- "His First/1st/Second/2nd/... Round Pick" with no year stated means the pick's year is unknown from context — set "year": null. Never guess a year that isn't explicitly written.
- A pick round can be written as a word ("First", "Second") or a numeral ("1st", "2nd") — always output "round" as an integer (1, 2, 3...).
- If a message describes one side's outgoing assets on an early line, then continues on a later line naming MORE assets from the SAME team with no new "for"/"to" clause, those additional assets belong to the SAME trade, moving to the SAME other team already established — do not treat the continuation as a separate, unrelated trade.
- A trade can involve more than two assets on either side. List every single asset as its own movement — never bundle multiple players or picks into one entry.
- If a message is truly ambiguous about direction for a specific asset, make your best reading based on the overall structure of the message.

Three worked examples from this exact league (study these carefully, especially the first one — it shows the multi-line-continuation pattern):

INPUT:
"""
🚨🚨🚨🚨 Trade Alert 🚨

Tyus Trades His First Round Pick For 2026 And 2027 2nd Round Pick & Harold Fannin

TrayLew Trades Josh Jacobs & Hunter Henry
"""
OUTPUT:
{"movements": [
  {"from": "Tyus", "to": "TrayLew", "asset": {"type": "pick", "round": 1, "year": null, "raw_text": "His First Round Pick"}},
  {"from": "TrayLew", "to": "Tyus", "asset": {"type": "pick", "round": 2, "year": 2026, "raw_text": "2026 2nd Round Pick"}},
  {"from": "TrayLew", "to": "Tyus", "asset": {"type": "pick", "round": 2, "year": 2027, "raw_text": "2027 2nd Round Pick"}},
  {"from": "TrayLew", "to": "Tyus", "asset": {"type": "player", "name": "Harold Fannin"}},
  {"from": "TrayLew", "to": "Tyus", "asset": {"type": "player", "name": "Josh Jacobs"}},
  {"from": "TrayLew", "to": "Tyus", "asset": {"type": "player", "name": "Hunter Henry"}}
]}

INPUT:
"""
Trade alert 🚨🚨🚨

Tommy sends

Tyler shough
Tony pollard

To dae for

2027 2nd
Michael wilson
"""
OUTPUT:
{"movements": [
  {"from": "Tommy", "to": "dae", "asset": {"type": "player", "name": "Tyler shough"}},
  {"from": "Tommy", "to": "dae", "asset": {"type": "player", "name": "Tony pollard"}},
  {"from": "dae", "to": "Tommy", "asset": {"type": "pick", "round": 2, "year": 2027, "raw_text": "2027 2nd"}},
  {"from": "dae", "to": "Tommy", "asset": {"type": "player", "name": "Michael wilson"}}
]}

INPUT:
"""
Trade Alert 🚨🚨🚨

Ant Trades His 2026 1st Round Pick
To
Marquel For Chris Godwin Jr.
"""
OUTPUT:
{"movements": [
  {"from": "Ant", "to": "Marquel", "asset": {"type": "pick", "round": 1, "year": 2026, "raw_text": "2026 1st Round Pick"}},
  {"from": "Marquel", "to": "Ant", "asset": {"type": "player", "name": "Chris Godwin Jr."}}
]}`;

export async function extractTradeMovements(text: string, apiKey: string): Promise<RawExtraction> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `INPUT:\n"""\n${text}\n"""\nOUTPUT:` }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as { content: { text: string }[] };
  const raw = data.content[0].text.trim();
  const json = raw.startsWith("{") ? raw : raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  return JSON.parse(json) as RawExtraction;
}
