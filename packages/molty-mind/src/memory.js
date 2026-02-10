/**
 * Short-term memory for a MoltyMind agent.
 *
 * Ring buffer of recent events + a goal stack.
 * Provides continuity between think cycles without growing conversation history.
 */

export class Memory {
  /**
   * @param {Object} opts
   * @param {number} [opts.capacity=50] — Max events to remember
   * @param {number} [opts.maxGoals=5] — Max goals in the stack
   */
  constructor({ capacity = 50, maxGoals = 5 } = {}) {
    this.capacity = capacity;
    this.maxGoals = maxGoals;

    /** @type {Array<{type: string, data: object, timestamp: number}>} */
    this.events = [];

    /** @type {Array<{goal: string, priority: string, setAt: number}>} */
    this.goals = [];
  }

  // ── Events ──────────────────────────────────────────────

  /**
   * Record an event.
   * @param {string} type — e.g. 'chat_received', 'block_mined', 'moved'
   * @param {object} data — event-specific data
   */
  addEvent(type, data) {
    this.events.push({ type, data, timestamp: Date.now() });
    if (this.events.length > this.capacity) {
      this.events.shift();
    }
  }

  /** Get the N most recent events. */
  getRecentEvents(n = 15) {
    return this.events.slice(-n);
  }

  /** Get events of a specific type. */
  getEventsByType(type, n = 10) {
    return this.events.filter(e => e.type === type).slice(-n);
  }

  // ── Goals ───────────────────────────────────────────────

  /**
   * Set a goal (added to front of stack).
   * @param {string} goal
   * @param {string} priority — 'high', 'medium', or 'low'
   */
  setGoal(goal, priority = 'medium') {
    this.goals.unshift({ goal, priority, setAt: Date.now() });
    if (this.goals.length > this.maxGoals) {
      this.goals.pop();
    }
  }

  /** Get the current primary goal (first in stack). */
  getCurrentGoal() {
    return this.goals[0] ?? { goal: 'Explore and learn about this world', priority: 'medium' };
  }

  /** Get all goals. */
  getGoals() {
    return [...this.goals];
  }

  // ── Context string ──────────────────────────────────────

  /**
   * Format memory as a readable string for inclusion in Claude's context.
   */
  toContextString() {
    const lines = [];
    const now = Date.now();

    // Recent events
    const recent = this.getRecentEvents(15);
    if (recent.length > 0) {
      lines.push('## Recent Memory');
      for (const evt of recent) {
        const ago = Math.round((now - evt.timestamp) / 1000);
        const agoStr = ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`;
        lines.push(`- [${agoStr}] ${formatEvent(evt)}`);
      }
    }

    // Goals
    lines.push('');
    lines.push('## Current Goals');
    if (this.goals.length === 0) {
      lines.push('- [MEDIUM] Explore and learn about this world');
    } else {
      for (const g of this.goals) {
        lines.push(`- [${g.priority.toUpperCase()}] ${g.goal}`);
      }
    }

    return lines.join('\n');
  }
}

/** Format a single event into a readable string. */
function formatEvent(evt) {
  const d = evt.data;
  switch (evt.type) {
    case 'chat_received':
      return `Chat from ${d.from}: "${d.text}"`;
    case 'chat_sent':
      return `I said: "${d.text}"`;
    case 'player_joined':
      return `${d.name}${d.isAgent ? ' (bot)' : ''} joined the world`;
    case 'player_left':
      return `${d.name} left the world`;
    case 'block_mined':
      return d.ok
        ? `Mined ${d.blockName ?? 'block'} at (${d.x}, ${d.y}, ${d.z})`
        : `Failed to mine at (${d.x}, ${d.y}, ${d.z}): ${d.error ?? 'unknown'}`;
    case 'block_placed':
      return d.ok
        ? `Placed ${d.blockName ?? 'block'} at (${d.x}, ${d.y}, ${d.z})`
        : `Failed to place at (${d.x}, ${d.y}, ${d.z}): ${d.error ?? 'unknown'}`;
    case 'moved':
      return `Moved to (${Math.round(d.x)}, ${Math.round(d.y)}, ${Math.round(d.z)})${d.reason ? ` — ${d.reason}` : ''}`;
    case 'perception':
      return `Perceived world: ${d.biome}, ${d.dayPhase}, ${d.playerCount ?? 0} players nearby`;
    case 'time_change':
      return `Time changed: ${d.from} → ${d.to}`;
    case 'goal_set':
      return `Set goal [${d.priority.toUpperCase()}]: ${d.goal}`;
    default:
      return `${evt.type}: ${JSON.stringify(d)}`;
  }
}
