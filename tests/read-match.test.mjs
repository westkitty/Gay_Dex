/**
 * Focused tests for the player-facing first-to-three Read match.
 * The classic battle engine stays covered separately by battle-equivalence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(ROOT, 'src/battle-core.js'), 'utf8');
const sandbox = {};
new Function('window', 'module', 'globalThis', source)(sandbox, undefined, sandbox);
const Core = sandbox.GayDexBattleCore;
const DEX = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/dex-entries.json'), 'utf8'));
const byId = Object.fromEntries(DEX.map((entry) => [entry.id, entry]));

function newMatch({
  a = 'twink', b = 'bear', seed = 73, scene = 'prism', intro = 'drop',
  arenaEffects = false, cpuSkill = 'rival', balanced = true,
} = {}) {
  Core.bindContext({ scene, intro, arenaEffects, cpuSkill });
  const match = Core.makeReadBattleMatch(byId[a], byId[b], balanced, seed);
  Core.applyBattleOpener(match);
  return match;
}

test('Read match is first to three decisive counters, with an exchange cap', () => {
  const match = newMatch();
  assert.equal(match.format, 'read');
  assert.deepEqual(match.score, { a: 0, b: 0 });
  assert.equal(Core.READ_BATTLE_POINTS, 3);
  assert.equal(Core.READ_BATTLE_MAX_EXCHANGES, 12);

  const first = Core.battleRound(match, 'flex', 'serve');
  assert.deepEqual(match.score, { a: 1, b: 0 });
  assert.equal(match.round, 2);
  assert.equal(first.find((event) => event.kind === 'point')?.side, 'a');

  const second = Core.battleRound(match, 'serve', 'read');
  assert.deepEqual(match.score, { a: 2, b: 0 });
  assert.ok(second.some((event) => event.kind === 'matchpoint' && event.side === 'a'));
  assert.equal(match.ended, false);

  const third = Core.battleRound(match, 'read', 'flex');
  assert.deepEqual(match.score, { a: 3, b: 0 });
  assert.equal(match.ended, true);
  assert.equal(match.winner, 'a');
  assert.equal(match.finishReason, 'three decisive exchanges');
  assert.ok(third.some((event) => event.kind === 'win' && event.side === 'a'));
  assert.equal(match.timeline.length, 3);
  assert.ok(match.log.some((line) => line.includes('FIRST TO 3')));
});

test('READ LOCK is a real prediction bonus, shield, Hype gain, point, and event', () => {
  const match = newMatch({ seed: 11 });
  const control = newMatch({ seed: 11 });
  // This is a previously revealed CPU move, not the player's pending choice.
  match.b.lastMove = 'serve';
  match.b.history = ['serve'];
  control.b.lastMove = 'read';
  control.b.history = ['read'];
  // Keep both bonuses observable at end-of-round rather than having the rival's
  // immediate retaliation consume the new shield in the same exchange.
  match.b.hp = 0;
  control.b.hp = 0;

  const events = Core.battleRound(match, 'flex', 'serve');
  const controlEvents = Core.battleRound(control, 'flex', 'serve');
  const lock = events.find((event) => event.kind === 'damage' && event.side === 'a' && event.predicted);
  const ordinary = controlEvents.find((event) => event.kind === 'damage' && event.side === 'a');
  assert.ok(lock, 'repeating Serve should be called out as a read');
  assert.equal(lock.readTarget, 'serve');
  assert.match(lock.text, /READ LOCK on repeated Serve/);
  assert.equal(match.a.metrics.readLocks, 1);
  assert.equal(match.score.a, 1);
  assert.equal(lock.hype, ordinary.hype + 10, 'READ LOCK should add exactly ten Hype');
  assert.equal(match.a.shield, control.a.shield + 6, 'READ LOCK should add six shield');
  assert.ok(match.timeline[0].tags.includes('READ LOCK'));
  assert.equal(match.timeline[0].pointSide, 'a');
});

test('Guard denies decisive points, its fatigue curve falls, and repeated defense still yields pressure', () => {
  const match = newMatch({ seed: 9 });
  const gains = [];
  for (let i = 0; i < Core.READ_BATTLE_MAX_EXCHANGES && !match.ended; i++) {
    const events = Core.battleRound(match, 'flex', 'guard');
    gains.push(events.find((event) => event.kind === 'guard' && event.side === 'b')?.shieldGain);
    assert.deepEqual(match.score, { a: 0, b: 0 }, 'Guard should deny a decisive counter point');
  }
  assert.deepEqual(gains.slice(0, 5), [10, 8, 5, 3, 3]);
  assert.equal(match.ended, true);
  assert.equal(match.round, Core.READ_BATTLE_MAX_EXCHANGES);
  assert.equal(match.finishReason, 'exchange limit');
  assert.equal(match.winner, 'a');
  assert.ok(match.b.hp < match.b.maxHp, 'guarding forever should not prevent pressure from landing');
});

test('varied Flex / Serve / Read builds a three-vector Flow Break; Signature spends Hype', () => {
  const match = newMatch({ seed: 29 });
  let third;
  for (const move of ['flex', 'serve', 'read']) {
    third = Core.battleRound(match, move, 'guard');
  }
  const burst = third.find((event) => event.kind === 'damage' && event.side === 'a' && event.flowBurst);
  assert.ok(burst, 'three distinct attack vectors should cash out Flow');
  assert.equal(burst.combo, 3);
  assert.equal(match.a.metrics.flowBreaks, 1);

  const sig = newMatch({ seed: 31 });
  sig.a.hype = 100;
  const events = Core.battleRound(sig, 'signature', 'guard');
  assert.ok(events.some((event) => event.kind === 'damage' && event.side === 'a' && event.move === 'signature'));
  assert.equal(sig.a.metrics.signatures, 1);
  assert.equal(sig.a.hype, 0);
  assert.equal(sig.a.sigCd, 1, 'signature cooldown should begin after the exchange');
  assert.deepEqual(sig.score, { a: 0, b: 0 }, 'signature pressure is not itself a decisive RPS counter');
});

test('arena pulse arrives on its forecast exchange in Read format', () => {
  const match = newMatch({ scene: 'aqua', intro: 'drop', arenaEffects: true, seed: 51 });
  Core.battleRound(match, 'guard', 'guard');
  Core.battleRound(match, 'guard', 'guard');
  assert.equal(match.round, 3);
  const events = Core.battleRound(match, 'guard', 'guard');
  const pulse = events.find((event) => event.kind === 'arena');
  assert.ok(pulse, 'forecast Aqua pulse was not emitted at exchange three');
  assert.match(pulse.text, /AQUA PULSE/);
  assert.ok(match.log.includes(pulse.text));
});

test('rival habits teach a measurable tell; harder profiles reduce habits without stat buffs', () => {
  const expected = { trainer: 0.62, rival: 0.46, nemesis: 0.28 };
  const baseStats = Core.battleStats(byId.bear, true);
  for (const [skill, probability] of Object.entries(expected)) {
    Core.bindContext({ scene: 'prism', intro: 'drop', arenaEffects: true, cpuSkill: skill });
    let habits = 0;
    const trials = 600;
    for (let seed = 1; seed <= trials; seed++) {
      const match = Core.makeReadBattleMatch(byId.twink, byId.bear, true, seed);
      const pick = Core.chooseReadRivalMove(match.b, match.a, match.decisionRng, match);
      if (pick.reason === 'cub habit') habits++;
      assert.ok(['flex', 'serve', 'read', 'guard', 'signature'].includes(pick.move));
      assert.equal(pick.skill, skill);
      assert.deepEqual(match.b.stats, baseStats, 'difficulty must not alter fighter stats');
    }
    const observed = habits / trials;
    assert.ok(Math.abs(observed - probability) < 0.035, `${skill} habit rate ${observed} did not match its readable profile`);
  }
});

test('seeded Read matches replay the same exchange history and finish', () => {
  function play(seed) {
    const match = newMatch({ a: 'twunk', b: 'bear', seed, scene: 'pride', intro: 'random', arenaEffects: true, cpuSkill: 'rival' });
    let exchanges = 0;
    while (!match.ended && exchanges++ < Core.READ_BATTLE_MAX_EXCHANGES) {
      const player = Core.aiBattleMove(match.a, match.b, match.decisionRng, match);
      const rival = Core.chooseReadRivalMove(match.b, match.a, match.decisionRng, match);
      Core.battleRound(match, player, rival.move);
    }
    return {
      log: match.log,
      score: match.score,
      winner: match.winner,
      finishReason: match.finishReason,
      timeline: match.timeline,
      hp: [match.a.hp, match.b.hp],
    };
  }
  const first = play(7777);
  assert.deepEqual(play(7777), first);
  assert.ok(first.winner === 'a' || first.winner === 'b' || first.winner === 'draw');
});
