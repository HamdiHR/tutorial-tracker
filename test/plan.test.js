import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPlan, computeSchedule, addDays } from '../server/plan.js';

const mk = (id, n, done = 0, steps = 10) => ({
  id, title: 'Sprint ' + id, ticketsTotal: n, ticketsDone: 0, total: steps, done, complete: false,
  items: Array.from({ length: n }, (_, i) => ({ id: `S${id}-T0${i + 1}`, title: 't' + i, kind: 'ticket', status: 'todo', deferred: 0 })),
});
const base = { startDate: '2027-01-04', workDays: [1, 2, 3, 4, 5], sprintDays: 5, perSprint: {}, daysOff: [] }; // Monday

test('plan: sprints follow working days, weekends are skipped', () => {
  const s = computeSchedule(base, [mk('0', 3), mk('1', 5)], '2027-01-01');
  assert.equal(s.sprints[0].start, '2027-01-04');
  assert.equal(s.sprints[0].end, '2027-01-08');
  assert.equal(s.sprints[1].start, '2027-01-11');
  assert.equal(s.plannedEnd, '2027-01-15');
  assert.equal(s.workDaysTotal, 10);
  assert.equal(s.weeks, 2);
  assert.equal(s.sprints[0].state, 'upcoming');
});

test('plan: fewer work days per week and days off stretch the calendar', () => {
  const s = computeSchedule({ ...base, workDays: [2, 4], sprintDays: 2, daysOff: ['2027-01-07'] }, [mk('0', 2), mk('1', 2)], '2027-01-01');
  assert.equal(s.sprints[0].start, '2027-01-05'); // Tue
  assert.equal(s.sprints[0].end, '2027-01-12'); // Thu 7 is off -> Tue 12
  assert.equal(s.sprints[1].start, '2027-01-14');
});

test('plan: per-sprint override, ticket due dates spread over the sprint', () => {
  const s = computeSchedule({ ...base, perSprint: { 1: 10 } }, [mk('0', 5), mk('1', 4)], '2027-01-04');
  assert.equal(s.sprints[1].days, 10);
  assert.deepEqual(s.sprints[0].schedule.map((t) => t.due), ['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08']);
  assert.equal(s.sprints[1].schedule.at(-1).due, s.sprints[1].end);
});

test('plan: ahead / behind / projection', () => {
  const sprints = [mk('0', 4, 10, 40), mk('1', 4, 0, 40)]; // 10 of 80 steps
  const late = computeSchedule(base, sprints, '2027-01-08'); // 5 days elapsed -> plan expects 40 steps
  assert.equal(late.today.expectedSteps, 40);
  assert.equal(late.today.deltaSteps, -30);
  assert.equal(late.sprints[0].state, 'behind');
  assert.ok(late.projectedEnd > late.plannedEnd);
  const fast = computeSchedule(base, [mk('0', 4, 40, 40), mk('1', 4, 20, 40)], '2027-01-08');
  assert.ok(fast.today.deltaSteps > 0);
  assert.ok(fast.projectedEnd < fast.plannedEnd);
});

test('plan: validation', () => {
  assert.throws(() => cleanPlan({ ...base, startDate: '2027-02-30' }), /start date/i);
  assert.throws(() => cleanPlan({ ...base, workDays: [] }), /working day/i);
  assert.throws(() => cleanPlan({ ...base, sprintDays: 0 }), /between 1 and 60/);
  assert.throws(() => cleanPlan({ ...base, daysOff: ['nope'] }), /valid dates/);
  assert.equal(addDays('2027-01-31', 1), '2027-02-01');
});

const mkSteps = (id, steps) => ({
  id, title: 'Sprint ' + id, ticketsTotal: steps.length, ticketsDone: 0, total: steps.reduce((a, b) => a + b, 0), done: 0, complete: false,
  items: steps.map((n, i) => ({ id: `S${id}-T0${i + 1}`, title: 't' + i, kind: 'ticket', status: 'todo', deferred: 0, total: n, done: 0 })),
});

test('team: tickets are split by workload, in order, each person spread over own days', () => {
  const plan = { ...base, sprintDays: 4, team: [{ name: 'Ana' }, { name: 'Bob' }] };
  const s = computeSchedule(plan, [mkSteps('1', [8, 4, 4, 4, 4, 4, 4])], '2027-01-01');
  const per = s.sprints[0].load;
  const sum = (m) => per.find((x) => x.member === m).steps;
  assert.equal(sum('m1') + sum('m2'), 32);
  assert.ok(Math.abs(sum('m1') - sum('m2')) <= 4); // balanced
  for (const m of ['m1', 'm2']) {
    const mine = s.sprints[0].schedule.filter((t) => t.member === m);
    assert.deepEqual(mine.map((t) => t.id), [...mine.map((t) => t.id)].sort()); // tutorial order kept
    assert.equal(mine.at(-1).due, s.sprints[0].end); // each person finishes by the sprint end
    for (const t of mine) assert.ok(t.start <= t.due);
  }
  assert.equal(s.team.length, 2);
  assert.equal(s.team[0].tickets + s.team[1].tickets, 7);
});

test('team: own working days, manual owner and manual dates', () => {
  const plan = { ...base, sprintDays: 5, team: [{ name: 'Ana', workDays: [1, 2, 3, 4, 5] }, { name: 'Bob', workDays: [1, 2], daysOff: ['2027-01-05'] }] };
  const s = computeSchedule(plan, [mkSteps('1', [4, 4, 4, 4])], '2027-01-01');
  const bob = s.sprints[0].schedule.filter((t) => t.member === 'm2');
  for (const t of bob) assert.ok(['2027-01-04'].includes(t.due) || t.due > '2027-01-05'); // never Tue 5 (day off) or Wed+
  const forced = computeSchedule({ ...plan, manual: { 'S1-T01': { member: 'm2', due: '2027-01-11', start: '2027-01-08' }, 'S1-T02': { member: 'ghost' } } }, [mkSteps('1', [4, 4, 4, 4])], '2027-01-01');
  const t1 = forced.sprints[0].schedule.find((t) => t.id === 'S1-T01');
  assert.equal(t1.member, 'm2');
  assert.equal(t1.due, '2027-01-11');
  assert.equal(t1.start, '2027-01-08');
  assert.ok(t1.manual.member && t1.manual.due);
  assert.equal(forced.plan.manual['S1-T02'], undefined); // unknown member dropped
});

test('team: validation and solo default', () => {
  assert.equal(cleanPlan(base).team.length, 1);
  assert.equal(cleanPlan(base).team[0].name, 'You');
  assert.throws(() => cleanPlan({ ...base, team: Array.from({ length: 13 }, () => ({})) }), /up to 12/);
});
