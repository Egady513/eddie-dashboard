/**
 * cos-sync.js — Chief of Staff Auto-Sync
 *
 * Runs automatically at the end of every Claude Code session via Stop hook.
 * Updates dashboard-data.json with session timestamp + automation feed entry,
 * then commits and pushes to GitHub so the live dashboard stays current.
 *
 * For agent activity tracking: if a session-agents.json file exists in this
 * folder (written by Claude during an agent session), it reads that and logs
 * agent activity to the automation feed before deleting the file.
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DASH_PATH    = path.dirname(__filename);
const DATA_FILE    = path.join(DASH_PATH, 'dashboard-data.json');
const SESSION_FILE = path.join(DASH_PATH, 'session-agents.json');

// ─── Read dashboard data ──────────────────────────────────────────────────────
let data;
try {
  data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch (e) {
  console.error('CoS Sync: Could not read dashboard-data.json:', e.message);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const now   = new Date().toISOString();

// ─── Update meta ──────────────────────────────────────────────────────────────
data.meta.lastUpdated = today;
if (!data.automationFeed) data.automationFeed = [];
if (!data.meridianLog)    data.meridianLog    = [];

// ─── Check for agent session file ─────────────────────────────────────────────
let sessionAgents = null;
if (fs.existsSync(SESSION_FILE)) {
  try {
    sessionAgents = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  } catch (e) {
    console.warn('CoS Sync: Could not parse session-agents.json — skipping');
  }
}

// ─── Build automation feed entry ─────────────────────────────────────────────
const feedEntry = {
  id:        `cos-sync-${Date.now()}`,
  timestamp: now,
  type:      'session-end',
  icon:      '⚙️',
  message:   sessionAgents
    ? `Session closed — ${sessionAgents.agents?.join(', ') ?? 'agents'} active on ${sessionAgents.project ?? 'unknown project'}`
    : 'Chief of Staff auto-sync — session ended, dashboard updated'
};

// ─── Update dashboard agents if session file has current task info ─────────────
if (sessionAgents?.agentUpdates) {
  sessionAgents.agentUpdates.forEach(update => {
    const agent = data.agents?.find(a => a.id === update.id);
    if (agent) {
      agent.status      = update.status      ?? agent.status;
      agent.currentTask = update.currentTask ?? agent.currentTask;
      agent.lastActive  = today;
    }
  });
}

// ─── Write feed entry (keep last 30) ─────────────────────────────────────────
data.automationFeed.unshift(feedEntry);
data.automationFeed = data.automationFeed.slice(0, 30);

// ─── Write Meridian log entry if session file has eval ───────────────────────
if (sessionAgents?.meridianEval) {
  data.meridianLog.unshift(sessionAgents.meridianEval);
  data.meridianLog = data.meridianLog.slice(0, 100); // keep last 100 evals
}

// ─── Write back ───────────────────────────────────────────────────────────────
try {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  console.log('CoS Sync: dashboard-data.json updated');
} catch (e) {
  console.error('CoS Sync: Could not write dashboard-data.json:', e.message);
  process.exit(1);
}

// ─── Clean up session file ────────────────────────────────────────────────────
if (fs.existsSync(SESSION_FILE)) {
  fs.unlinkSync(SESSION_FILE);
  console.log('CoS Sync: session-agents.json consumed and deleted');
}

// ─── Git commit and push ──────────────────────────────────────────────────────
try {
  execSync('git add dashboard-data.json', { cwd: DASH_PATH, stdio: 'pipe' });
  execSync(
    `git commit -m "auto: CoS sync ${today} — session ended"`,
    { cwd: DASH_PATH, stdio: 'pipe' }
  );
  execSync('git push origin main', { cwd: DASH_PATH, stdio: 'pipe' });
  console.log('CoS Sync: pushed to GitHub ✓');
} catch (e) {
  // Commit fails when there are no changes — that's fine
  const msg = e.stdout?.toString() ?? e.message;
  if (msg.includes('nothing to commit')) {
    console.log('CoS Sync: no changes to push');
  } else {
    console.warn('CoS Sync: git error —', msg);
  }
}

console.log('CoS Sync complete.');
