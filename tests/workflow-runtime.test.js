const test = require('node:test');
const assert = require('node:assert/strict');
const Runtime = require('../workflow-runtime.js');

test('workflow runtime orders a connected DAG by dependencies', () => {
  const nodes = [
    { id: 'image', type: 'image' },
    { id: 'generate', type: 'generator' },
    { id: 'layout', type: 'layout' }
  ];
  const edges = [
    { from: 'image', to: 'generate' },
    { from: 'generate', to: 'layout' }
  ];
  const plan = Runtime.topologicalOrder(['layout', 'image', 'generate'], edges);
  assert.deepEqual(plan.order, ['image', 'generate', 'layout']);
  assert.deepEqual(plan.cycles, []);
});

test('workflow runtime continues independent branches after a failure', async () => {
  const nodes = [
    { id: 'a' },
    { id: 'a-child' },
    { id: 'b' },
    { id: 'b-child' }
  ];
  const edges = [
    { from: 'a', to: 'a-child' },
    { from: 'b', to: 'b-child' }
  ];
  const called = [];
  const result = await Runtime.runDag({
    nodes,
    edges,
    nodeIds: nodes.map(node => node.id),
    execute: async node => {
      called.push(node.id);
      if (node.id === 'a') throw new Error('failed branch');
      return { status: 'success' };
    }
  });
  assert.deepEqual(called, ['a', 'b', 'b-child']);
  assert.equal(result.results.a.status, 'failed');
  assert.equal(result.results['a-child'].status, 'skipped');
  assert.equal(result.results['b-child'].status, 'success');
});

test('workflow runtime pauses at review and skips downstream nodes', async () => {
  const nodes = [
    { id: 'images' },
    { id: 'soft' },
    { id: 'layout' }
  ];
  const edges = [
    { from: 'images', to: 'soft' },
    { from: 'soft', to: 'layout' }
  ];
  const result = await Runtime.runDag({
    nodes,
    edges,
    nodeIds: nodes.map(node => node.id),
    execute: async node => node.id === 'soft'
      ? { status: 'waiting', message: '等待软装确认' }
      : { status: 'success' }
  });
  assert.equal(result.results.images.status, 'success');
  assert.equal(result.results.soft.status, 'waiting');
  assert.equal(result.results.layout.status, 'skipped');
  assert.equal(result.summary.waiting, 1);
  assert.equal(result.summary.skipped, 1);
});

test('workflow runtime rejects cycles before running any node', async () => {
  await assert.rejects(() => Runtime.runDag({
    nodes: [{ id: 'a' }, { id: 'b' }],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
    nodeIds: ['a', 'b'],
    execute: async () => ({ status: 'success' })
  }), /循环依赖/);
});
