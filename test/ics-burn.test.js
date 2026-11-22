import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSchedule } from '../server/plan.js';

const sprint = { id: '1', title: 'S', ticketsTotal: 2, ticketsDone: 0, total: 6, done: 2, complete: false, items: [
  { id: 'S1-A', title: 'a', kind: 'ticket', status: 'doing', deferred: 0, total: 3, done: 2 },
  { id: 'S1-B', title: 'b', kind: 'ticket', status: 'todo', deferred: 0, total: 3, done: 0 }] };
const plan = { anchor: 'start', startDate: '2027-01-04', workDays: [1, 2, 3, 4, 5], sprintDays: 5, perSprint: {}, daysOff: [] };

test('burndown: planned falls to 0, actual matches what is left now and walks back by logged ticks', () => {
  const s = computeSchedule(plan, [sprint], '2027-01-06', { daily: { '2027-01-05': 1, '2027-01-06': 1 } });
  assert.ok(s.burn);
  assert.equal(s.burn.scope, 6);
  assert.equal(s.burn.left, 4);
  assert.equal(s.burn.planned.at(-1), 0);
  const ti = s.burn.days.indexOf('2027-01-06');
  assert.equal(s.burn.actual[ti], 4);
  assert.equal(s.burn.actual[s.burn.days.indexOf('2027-01-04')], 6);
  assert.equal(s.burn.actual.length, ti + 1);
});
