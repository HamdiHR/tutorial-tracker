import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPlan, computeSchedule, addDays } from '../server/plan.js';

// sprint with n tickets of 10 steps; `doneN` first tickets done (all their steps ticked)
const sp = (id, n, doneN = 0, extra = {}) => {
  const items = Array.from({ length: n }, (_, i) => ({ id: `S${id}-T0${i + 1}`, title: 't' + i, kind: 'ticket', status: i < doneN ? 'done' : 'todo', deferred: 0, total: 10, done: i < doneN ? 10 : 0, ...(extra.doneOn && i < doneN ? { doneOn: extra.doneOn } : {}) }));
  return { id: String(id), title: 'Sprint ' + id, ticketsTotal: n, ticketsDone: doneN, total: n * 10, done: doneN * 10, complete: doneN === n, items, ...(doneN === n && extra.doneOn ? { doneOn: extra.doneOn } : {}) };
};
const here = { anchor: 'here', startDate: '2027-01-04', workDays: [1, 2, 3, 4, 5], sprintDays: 5, perSprint: {}, daysOff: [] }; // Monday
const run = (plan, sprints, today = '2027-01-04', extra) => computeSchedule(plan, sprints, today, extra);

test('anchor here: finished sprints are history, unfinished work starts at the anchor', () => {
  const s = run(here, [sp(1, 3, 3), sp(2, 3, 3), sp(3, 3, 3), sp(4, 4), sp(5, 4)]);
  assert.deepEqual(s.sprints.map((r) => r.state === 'done' && r.history), [true, true, true, false, false]);
  assert.equal(s.sprints[3].start, '2027-01-04');
  assert.equal(s.sprints[3].end, '2027-01-08');
  assert.equal(s.sprints[4].start, '2027-01-11');
  assert.equal(s.plannedEnd, '2027-01-15');
  assert.equal(s.workDaysTotal, 10); // history uses no future days
  assert.equal(s.historySprints, 3);
});

test('anchor start (legacy) is untouched by progress', () => {
  const s = run({ ...here, anchor: 'start' }, [sp(1, 3, 3), sp(2, 3)]);
  assert.equal(s.sprints[0].start, '2027-01-04');
  assert.equal(s.sprints[1].start, '2027-01-11');
  assert.ok(!s.sprints[0].history);
});

test('partial sprint: only remaining tickets are spread, window shrinks, done tickets are history', () => {
  const s = run(here, [sp(1, 4, 1)]); // 10 of 40 steps done, 5-day sprint
  const r = s.sprints[0];
  assert.equal(r.days, 4); // ceil(5 * 30/40)
  assert.equal(r.start, '2027-01-04');
  assert.equal(r.schedule.length, 4);
  assert.equal(r.schedule[0].history, true);
  assert.ok(r.schedule.slice(1).every((t) => t.due >= '2027-01-04' && t.due <= r.end));
  assert.equal(r.partial, true);
});

test('partial shrink is skipped when the sprint length was set explicitly', () => {
  const s = run({ ...here, perSprint: { 1: 8 } }, [sp(1, 4, 1)]);
  assert.equal(s.sprints[0].days, 8);
});

test('out of order: a later sprint finished first, earlier one still gets the anchor', () => {
  const s = run(here, [sp(1, 3), sp(2, 3, 3), sp(3, 3)]);
  assert.equal(s.sprints[0].start, '2027-01-04');
  assert.equal(s.sprints[1].history, true);
  assert.equal(s.sprints[2].start, '2027-01-11');
});

test('everything finished: no future schedule, projected end is done', () => {
  const s = run(here, [sp(1, 2, 2), sp(2, 2, 2)]);
  assert.equal(s.projectedEnd, 'done');
  assert.equal(s.workDaysTotal, 0);
  assert.equal(s.sprints.every((r) => r.history), true);
});

test('nothing finished: anchor here equals anchor start', () => {
  const a = run(here, [sp(1, 3), sp(2, 3)]);
  const b = run({ ...here, anchor: 'start' }, [sp(1, 3), sp(2, 3)]);
  assert.deepEqual(a.sprints.map((r) => [r.start, r.end]), b.sprints.map((r) => [r.start, r.end]));
});

test('history dates: real completion dates are used, unknown ones are flagged as assumed', () => {
  const s = run(here, [sp(1, 2, 2, { doneOn: '2026-12-15' }), sp(2, 2, 2)]);
  assert.equal(s.sprints[0].end, '2026-12-15');
  assert.equal(s.sprints[0].assumed, false);
  assert.equal(s.sprints[1].assumed, true);
  assert.equal(s.sprints[1].end, '2027-01-03'); // the day before the anchor
});

test('days off and weekends still apply after the anchor', () => {
  const s = run({ ...here, daysOff: ['2027-01-05'] }, [sp(1, 2, 2), sp(2, 2)]);
  assert.equal(s.sprints[1].start, '2027-01-04');
  assert.equal(s.sprints[1].end, '2027-01-11'); // Tue 5 is off: Mon, Wed, Thu, Fri, Mon
});

test('target end date: remaining sprints share the available working days by remaining steps', () => {
  const s = run({ ...here, targetEnd: '2027-01-29' }, [sp(1, 2, 2), sp(2, 2), sp(3, 6)]); // 20 working days, 20 + 60 steps left
  assert.equal(s.fit.ok, true);
  assert.equal(s.fit.days, 20);
  assert.equal(s.sprints[1].days, 5);
  assert.equal(s.sprints[2].days, 15);
  assert.equal(s.plannedEnd, '2027-01-29');
});

test('target end date that is too tight is reported, never silently ignored', () => {
  const s = run({ ...here, targetEnd: '2027-01-05' }, [sp(1, 5), sp(2, 5)]); // 2 days for 100 steps
  assert.equal(s.fit.neededPace, 50);
  assert.ok(s.sprints.every((r) => r.days >= 1));
  assert.equal(typeof s.fit.ok, 'boolean');
});

test('target end before the start is rejected', () => {
  assert.throws(() => cleanPlan({ ...here, targetEnd: '2026-12-01' }), /target end/i);
});

test('pace only counts work done since the anchor (baseSteps)', () => {
  const sprints = [sp(1, 3, 3), sp(2, 3)]; // 30 steps done before the anchor
  const none = run({ ...here, baseSteps: 30 }, sprints, '2027-01-12');
  assert.equal(none.pace, null); // nothing done since: not enough data, not a fake fast pace
  const some = run({ ...here, baseSteps: 30 }, [sp(1, 3, 3), sp(2, 3, 1)], '2027-01-08');
  assert.ok(some.pace > 0 && some.pace <= 10);
});

test('forecast gives a range from recent velocity', () => {
  const sprints = [sp(1, 3, 3), sp(2, 3, 1), sp(3, 6)];
  const daily = { '2027-01-04': 2, '2027-01-05': 2, '2027-01-06': 2, '2027-01-07': 8, '2027-01-08': 10 };
  const s = run({ ...here, baseSteps: 30 }, sprints, '2027-01-08', { daily });
  assert.ok(s.forecast.fast && s.forecast.slow && s.forecast.expected);
  assert.ok(s.forecast.fast <= s.forecast.expected && s.forecast.expected <= s.forecast.slow);
});

test('deferred tickets never count as capacity or lateness', () => {
  const x = sp(1, 3);
  x.items[2].deferred = 1;
  x.ticketsTotal = 2;
  const s = run(here, [x]);
  assert.equal(s.sprints[0].schedule.length, 2);
});

test('team of two: history is not counted as anyone\'s workload', () => {
  const plan = { ...here, team: [{ name: 'Me' }, { name: 'Claude' }] };
  const s = run(plan, [sp(1, 4, 4), sp(2, 4)]);
  assert.equal(s.team.reduce((a, m) => a + m.tickets, 0), 4);
  assert.equal(s.sprints[0].load.every((l) => l.tickets === 0), true);
});

test('returning after weeks away: re-anchoring on a later date keeps history and moves the future', () => {
  const a = run(here, [sp(1, 2, 2), sp(2, 2)]);
  const b = run({ ...here, startDate: addDays(here.startDate, 28) }, [sp(1, 2, 2), sp(2, 2)], '2027-02-01');
  assert.equal(a.sprints[1].start, '2027-01-04');
  assert.equal(b.sprints[1].start, '2027-02-01');
  assert.equal(b.sprints[0].history, true);
});

test('plan without the new fields still loads (old saved plans)', () => {
  const p = cleanPlan({ startDate: '2027-01-04', workDays: [1, 2, 3, 4, 5], sprintDays: 5 });
  assert.equal(p.anchor, 'start');
  assert.equal(p.baseSteps, 0);
  assert.equal(p.targetEnd, null);
});
