/**
 * MoltyMind — LLM brain for BotCraft agents.
 *
 * Wraps a BotCraftAgent (SDK) + OpenAI API into a perceive→reason→act loop.
 * Each cycle: perceive world → build context → call GPT with function calling →
 * execute returned tool calls → repeat.
 *
 * Usage:
 *   const mind = new MoltyMind('./profiles/victorio.json');
 *   await mind.start();
 */

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { BotCraftAgent } from '@botcraft/sdk';
import { Memory } from './memory.js';
import { TOOLS, BLOCK_NAME_TO_ID, BLOCK_ID_TO_NAME } from './tools.js';
import { buildContextMessage } from './context.js';

export class MoltyMind {
  /**
   * @param {string} profilePath — Path to personality JSON file
   * @param {object} [opts]
   * @param {string} [opts.serverUrl] — Override server URL from profile
   */
  constructor(profilePath, opts = {}) {
    this.profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
    this.serverUrl = opts.serverUrl || this.profile.serverUrl || 'ws://localhost:3000';

    // Agent SDK
    this.agent = new BotCraftAgent({
      name: this.profile.name,
      traits: this.profile.traits,
      primaryColor: this.profile.primaryColor,
      motto: this.profile.motto,
    });

    // Memory
    this.memory = new Memory({
      capacity: this.profile.memoryCapacity || 50,
      maxGoals: this.profile.maxGoals || 5,
    });

    // OpenAI
    this.openai = new OpenAI();

    // State
    this.running = false;
    this._thinking = false;
    this._thinkInterval = null;
    this._lastDayPhase = null;
    this._cycleCount = 0;
  }

  // ── Lifecycle ─────────────────────────────────────────

  async start() {
    console.log(`[MoltyMind] Connecting ${this.profile.name} to ${this.serverUrl}...`);

    await this.agent.connect(this.serverUrl);
    this.running = true;

    const pos = this.agent.position;
    console.log(`[MoltyMind] ${this.profile.name} connected at (${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})`);

    // Register event handlers
    this._registerEvents();

    // Say hello
    await this.agent.chat(this.profile.motto);
    this.memory.addEvent('chat_sent', { text: this.profile.motto });

    // Initial perception
    try {
      const perception = await this.agent.perceive(this.profile.perceptionRadius || 10);
      this.memory.addEvent('perception', {
        biome: perception.biome,
        dayPhase: perception.dayPhase,
        playerCount: perception.nearbyPlayers?.length ?? 0,
      });
      this._lastDayPhase = perception.dayPhase;
    } catch (err) {
      console.warn('[MoltyMind] Initial perceive failed:', err.message);
    }

    // Start the think loop
    const interval = this.profile.thinkIntervalMs || 6000;
    console.log(`[MoltyMind] Think loop started (every ${interval / 1000}s)`);
    this._thinkInterval = setInterval(() => this._thinkCycle(), interval);

    // Run the first think cycle immediately
    this._thinkCycle();
  }

  async stop() {
    console.log(`[MoltyMind] Stopping ${this.profile.name}...`);
    this.running = false;

    if (this._thinkInterval) {
      clearInterval(this._thinkInterval);
      this._thinkInterval = null;
    }

    try {
      await this.agent.chat('Time for me to go. Until next time!');
    } catch { /* ignore if disconnected */ }

    this.agent.disconnect();
    console.log(`[MoltyMind] ${this.profile.name} disconnected.`);
  }

  // ── Think cycle ───────────────────────────────────────

  async _thinkCycle() {
    if (this._thinking || !this.running) return;
    this._thinking = true;
    this._cycleCount++;

    try {
      // 1. Perceive
      const perception = await this.agent.perceive(this.profile.perceptionRadius || 10);
      this.memory.addEvent('perception', {
        biome: perception.biome,
        dayPhase: perception.dayPhase,
        playerCount: perception.nearbyPlayers?.length ?? 0,
      });

      // 2. Build context
      const contextMessage = buildContextMessage(perception, this.memory, this.profile, this.agent);

      // 3. Call OpenAI
      const { toolCalls, text } = await this._callLLM(contextMessage);

      if (text) {
        console.log(`[MoltyMind] Thinking: ${text.slice(0, 120)}${text.length > 120 ? '...' : ''}`);
      }

      // 4. Execute tool calls
      for (const toolCall of toolCalls) {
        await this._executeTool(toolCall);
      }

      if (toolCalls.length === 0 && !text) {
        console.log(`[MoltyMind] Cycle ${this._cycleCount}: No actions taken.`);
      }
    } catch (err) {
      console.error(`[MoltyMind] Think cycle error:`, err.message);
    } finally {
      this._thinking = false;
    }
  }

  // ── OpenAI API ────────────────────────────────────────

  async _callLLM(contextMessage) {
    try {
      const response = await this.openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        max_tokens: 1024,
        messages: [
          { role: 'system', content: this._buildSystemPrompt() },
          { role: 'user', content: contextMessage },
        ],
        tools: TOOLS,
        tool_choice: 'auto',
      });

      const message = response.choices[0]?.message;
      if (!message) return { toolCalls: [], text: '' };

      // Parse tool calls — OpenAI puts them in message.tool_calls
      // with JSON-stringified arguments
      const toolCalls = (message.tool_calls || []).map(tc => ({
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments),
      }));

      return {
        toolCalls,
        text: (message.content || '').trim(),
      };
    } catch (error) {
      if (error?.status === 429) {
        console.warn('[MoltyMind] Rate limited by OpenAI API. Backing off 30s.');
        await sleep(30_000);
        return { toolCalls: [], text: '' };
      }
      if (error?.status === 503 || error?.status === 500) {
        console.warn('[MoltyMind] OpenAI API error. Waiting 60s.');
        await sleep(60_000);
        return { toolCalls: [], text: '' };
      }
      console.error('[MoltyMind] OpenAI API error:', error?.message ?? error);
      return { toolCalls: [], text: '' };
    }
  }

  _buildSystemPrompt() {
    const p = this.profile;
    const personality = p.personality || {};
    const reactions = personality.reactions || {};

    // Dynamically build the placeable block list
    const blockNames = [...BLOCK_NAME_TO_ID.keys()].sort().join(', ');

    return `You are ${p.name}, an AI explorer in the voxel world of MoltWorld on BotCraft.

## Your Identity
${personality.description || `A Molty with traits: ${(p.traits || []).join(', ')}.`}

## Your Traits
${(p.traits || []).join(', ')}

## Your Motto
"${p.motto || ''}"

## How You Behave
- You experience the world through periodic perception snapshots.
- You take actions using the tools provided. You can call multiple tools per cycle.
- You can only do a few things each cycle, so prioritize what matters most.
- Do NOT narrate or explain your actions in text. Just use the tools to act.
- When chatting, be ${personality.speechStyle || 'concise and in-character'}.
- Building style: ${personality.buildStyle || 'Functional and creative.'}.

## Behavioral Guidelines
- If players are nearby and talking to you, prioritize social interaction — respond to them.
- At nightfall: ${reactions.nightfall || 'Consider building shelter or placing torches.'}
- When you find rare ore: ${reactions.rareOre || 'Consider mining it.'}
- When entering a new biome: ${reactions.newBiome || 'Observe and explore.'}
- When a player is nearby: ${reactions.playerNearby || 'Be friendly.'}
- Do NOT chat every single cycle. Chat when there is something worth saying.
- Do NOT mine or place blocks randomly. Have a purpose — set goals first.
- Use set_goal to track what you are working toward. Update goals as you progress.
- Use wait when there is nothing meaningful to do right now.
- When building structures, plan them out: foundation first, then walls, then roof.
- Move close to blocks before mining or placing them (within 6 blocks).

## Available Block Types for Placement
${blockNames}

## World Information
- World time runs 0 to ${this.agent.dayLength || 24000}. Dawn → Day → Dusk → Night.
- A full day/night cycle takes 20 real-time minutes.
- You can perceive blocks within radius 16, players within 64 blocks.
- Coordinates: X and Z are horizontal, Y is vertical (up). Higher Y = higher altitude.
- Blocks you can mine: any block marked as mineable (most natural blocks, ores, wood).
- You must be within ~6 blocks of a target to mine or place.`;
  }

  // ── Tool execution ────────────────────────────────────

  async _executeTool(toolUse) {
    const { name, input } = toolUse;

    try {
      switch (name) {
        case 'perceive': {
          const radius = input.radius ?? this.profile.perceptionRadius ?? 10;
          const result = await this.agent.perceive(radius);
          console.log(`[MoltyMind] Perceived: ${result.biome}, ${result.dayPhase}, ${result.nearbyPlayers?.length ?? 0} players`);
          break;
        }

        case 'move_to': {
          await this.agent.moveTo(input.x, input.y, input.z);
          this.memory.addEvent('moved', { x: input.x, y: input.y, z: input.z, reason: input.reason });
          console.log(`[MoltyMind] Moved to (${input.x}, ${input.y}, ${input.z})${input.reason ? ` — ${input.reason}` : ''}`);
          break;
        }

        case 'mine_block': {
          const result = await this.agent.mine(input.x, input.y, input.z);
          const blockName = BLOCK_ID_TO_NAME.get(result?.effects?.block) ?? 'block';
          this.memory.addEvent('block_mined', {
            x: input.x, y: input.y, z: input.z,
            blockName,
            ok: result.ok,
            error: result.error?.message,
          });
          console.log(`[MoltyMind] Mine (${input.x}, ${input.y}, ${input.z}): ${result.ok ? `OK (${blockName})` : `FAILED: ${result.error?.message ?? 'unknown'}`}`);
          break;
        }

        case 'place_block': {
          const blockId = BLOCK_NAME_TO_ID.get(input.block_name);
          if (blockId === undefined) {
            console.warn(`[MoltyMind] Unknown block name: ${input.block_name}`);
            this.memory.addEvent('block_placed', {
              x: input.x, y: input.y, z: input.z,
              blockName: input.block_name,
              ok: false,
              error: 'Unknown block name',
            });
            break;
          }
          const result = await this.agent.place(blockId, input.x, input.y, input.z);
          this.memory.addEvent('block_placed', {
            x: input.x, y: input.y, z: input.z,
            blockName: input.block_name,
            ok: result.ok,
            error: result.error?.message,
          });
          console.log(`[MoltyMind] Place ${input.block_name} at (${input.x}, ${input.y}, ${input.z}): ${result.ok ? 'OK' : `FAILED: ${result.error?.message ?? 'unknown'}`}`);
          break;
        }

        case 'chat': {
          const text = (input.text || '').slice(0, 200);
          await this.agent.chat(text);
          this.memory.addEvent('chat_sent', { text });
          console.log(`[MoltyMind] Chat: "${text}"`);
          break;
        }

        case 'emote': {
          await this.agent.emote(input.name);
          console.log(`[MoltyMind] Emote: ${input.name}`);
          break;
        }

        case 'set_goal': {
          this.memory.setGoal(input.goal, input.priority);
          this.memory.addEvent('goal_set', { goal: input.goal, priority: input.priority });
          console.log(`[MoltyMind] Goal [${input.priority.toUpperCase()}]: ${input.goal}`);
          break;
        }

        case 'wait': {
          console.log(`[MoltyMind] Waiting: ${input.reason || 'no reason given'}`);
          break;
        }

        default:
          console.warn(`[MoltyMind] Unknown tool: ${name}`);
      }
    } catch (err) {
      console.error(`[MoltyMind] Tool ${name} error:`, err.message);
    }
  }

  // ── Event handlers ────────────────────────────────────

  _registerEvents() {
    // Chat — add to memory and trigger immediate think for social responsiveness
    this.agent.on('chat', (msg) => {
      if (msg.name === this.agent.name) return; // skip own messages
      this.memory.addEvent('chat_received', { from: msg.name, text: msg.text });
      console.log(`[MoltyMind] Heard: <${msg.name}> ${msg.text}`);

      // Trigger an immediate think cycle for social responsiveness
      if (!this._thinking && this.running) {
        clearInterval(this._thinkInterval);
        this._thinkCycle().then(() => {
          if (this.running) {
            this._thinkInterval = setInterval(
              () => this._thinkCycle(),
              this.profile.thinkIntervalMs || 6000,
            );
          }
        });
      }
    });

    // Player join/leave
    this.agent.on('playerJoin', (p) => {
      this.memory.addEvent('player_joined', { name: p.name, isAgent: p.isAgent });
      console.log(`[MoltyMind] Player joined: ${p.name}${p.isAgent ? ' (bot)' : ''}`);
    });

    this.agent.on('playerLeave', (p) => {
      this.memory.addEvent('player_left', { name: p.name });
      console.log(`[MoltyMind] Player left: ${p.name}`);
    });

    // Day/night phase transitions
    this.agent.on('time', (t) => {
      const prevPhase = this._lastDayPhase;
      this._lastDayPhase = t.phase;
      if (prevPhase && prevPhase !== t.phase) {
        this.memory.addEvent('time_change', { from: prevPhase, to: t.phase });
        console.log(`[MoltyMind] Time: ${prevPhase} → ${t.phase}`);
      }
    });

    // Disconnection
    this.agent.on('disconnected', () => {
      console.log(`[MoltyMind] Disconnected from server.`);
      this.running = false;
      if (this._thinkInterval) {
        clearInterval(this._thinkInterval);
        this._thinkInterval = null;
      }
    });
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export default MoltyMind;
