const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../graph-core.js');

test('port compatibility follows declared socket types', () => {
  assert.equal(Core.canConnect('image', 'generator', 'structure'), true);
  assert.equal(Core.canConnect('param', 'generator', 'params'), true);
  assert.equal(Core.canConnect('param', 'generator', 'structure'), false);
  assert.equal(Core.canConnect('material', 'generator', 'material'), true);
  assert.equal(Core.canConnect('light', 'generator', 'light'), true);
  assert.equal(Core.canConnect('light', 'generator', 'params'), false);
  assert.equal(Core.canConnect('material', 'generator', 'light'), false);
  assert.equal(Core.canConnect('tool', 'generator', 'prompt'), true);
  assert.equal(Core.canConnect('image', 'generator', 'prompt'), false);
  assert.equal(Core.canConnect('generator', 'generator', 'prompt'), false);
  assert.equal(Core.canConnect('image', 'layout', 'media'), true);
  assert.equal(Core.canConnect('variant', 'soft', 'image'), true);
  assert.equal(Core.canConnect('soft', 'layout', 'soft'), true);
  assert.equal(Core.canConnect('image', 'layout', 'soft'), false);
});

test('reverse-prompt tools connect to the generator prompt input', () => {
  const graph = new Core.GraphStore();
  graph.addNode({ id: 'structure', type: 'image' });
  graph.addNode({ id: 'reverse', type: 'tool' });
  graph.addNode({ id: 'gen', type: 'generator' });
  graph.addEdge({ id: 'prompt-edge', from: 'reverse', to: 'gen', port: 'prompt' });
  graph.addEdge({ id: 'default-edge', from: 'structure', to: 'gen' });
  assert.equal(graph.inputCount('gen', 'prompt'), 1);
  assert.equal(graph.inputCount('gen', 'structure'), 1);
  assert.equal(graph.serialize().find(edge => edge.id === 'prompt-edge').port, 'prompt');
});

test('soft-goods lists feed layout pages without competing with media inputs', () => {
  const graph = new Core.GraphStore();
  graph.addNode({ id: 'img1', type: 'image' });
  graph.addNode({ id: 'img2', type: 'image' });
  graph.addNode({ id: 'soft1', type: 'soft' });
  graph.addNode({ id: 'soft2', type: 'soft' });
  graph.addNode({ id: 'layout', type: 'layout' });

  graph.addEdge({ id: 's1', from: 'img1', to: 'soft1', port: 'image' });
  graph.addEdge({ id: 's2', from: 'img2', to: 'soft2', port: 'image' });
  graph.addEdge({ id: 'l1', from: 'img1', to: 'layout', port: 'media' });
  graph.addEdge({ id: 'l2', from: 'img2', to: 'layout', port: 'media' });
  graph.addEdge({ id: 'l3', from: 'soft1', to: 'layout', port: 'soft' });
  graph.addEdge({ id: 'l4', from: 'soft2', to: 'layout', port: 'soft' });

  assert.equal(graph.inputCount('layout', 'media'), 2);
  assert.equal(graph.inputCount('layout', 'soft'), 2);
  for (let i = 3; i <= 9; i++) {
    graph.addNode({ id: 'img' + i, type: 'image' });
    graph.addEdge({ from: 'img' + i, to: 'soft1', port: 'image' });
  }
  assert.throws(
    () => graph.addEdge({ from: 'img2', to: 'soft1', port: 'image' }),
    /输入端口已满/
  );
});

test('graph store enforces input limits and prevents cycles', () => {
  const graph = new Core.GraphStore();
  graph.addNode({ id: 'img1', type: 'image' });
  graph.addNode({ id: 'img2', type: 'image' });
  graph.addNode({ id: 'img3', type: 'image' });
  graph.addNode({ id: 'img4', type: 'image' });
  graph.addNode({ id: 'img5', type: 'image' });
  graph.addNode({ id: 'img6', type: 'image' });
  graph.addNode({ id: 'gen', type: 'generator' });
  graph.addNode({ id: 'tool1', type: 'tool' });
  graph.addNode({ id: 'tool2', type: 'tool' });
  graph.addNode({ id: 'tool3', type: 'tool' });

  graph.addEdge({ id: 'e1', from: 'img1', to: 'gen', port: 'structure' });
  graph.addEdge({ id: 'e1b', from: 'img2', to: 'gen', port: 'structure' });
  graph.addEdge({ id: 'e1c', from: 'img3', to: 'gen', port: 'structure' });
  graph.addEdge({ id: 'e1d', from: 'img4', to: 'gen', port: 'structure' });
  graph.addEdge({ id: 'e1e', from: 'img5', to: 'gen', port: 'structure' });
  assert.equal(graph.inputCount('gen', 'structure'), 5);
  assert.throws(
    () => graph.addEdge({ from: 'img6', to: 'gen', port: 'structure' }),
    /输入端口已满/
  );

  graph.addEdge({ id: 'e2', from: 'gen', to: 'tool1', port: 'image' });
  graph.addEdge({ id: 'e3', from: 'tool1', to: 'tool2', port: 'image' });
  graph.addEdge({ id: 'e4', from: 'tool2', to: 'tool3', port: 'reference' });
  assert.throws(
    () => graph.addEdge({ from: 'tool3', to: 'tool1', port: 'reference' }),
    /循环/
  );
});

test('visual tool inputs support four-camera mark groups', () => {
  const graph = new Core.GraphStore();
  for (let i = 1; i <= 5; i++) graph.addNode({ id: 'camera' + i, type: 'image' });
  graph.addNode({ id: 'mark', type: 'tool' });
  for (let i = 1; i <= 4; i++) {
    graph.addEdge({ from: 'camera' + i, to: 'mark', port: 'image' });
  }
  assert.equal(graph.inputCount('mark', 'image'), 4);
  assert.throws(
    () => graph.addEdge({ from: 'camera5', to: 'mark', port: 'image' }),
    /输入端口已满/
  );
});

test('schema migration preserves data and upgrades version', () => {
  const migrated = Core.migrateCanvasState({
    version: 2,
    nodes: [
      { id: 'a', type: 'image' },
      { type: 'note', text: '旧便签' }
    ],
    roomRefs: { '客厅': { nodeId: 'a' } }
  });
  assert.equal(migrated.version, Core.SCHEMA_VERSION);
  assert.equal(migrated.migratedFrom, 2);
  assert.equal(migrated.nodes.length, 2);
  assert.ok(migrated.nodes[1].id);
  assert.equal(migrated.nodes[1].type, 'note');
  assert.deepEqual(migrated.stage, { x: 0, y: 0, scale: 1 });
  assert.deepEqual(migrated.edges, []);
});

test('node synchronization prunes edges that reference removed nodes', () => {
  const graph = new Core.GraphStore();
  graph.addNode({ id: 'img', type: 'image' });
  graph.addNode({ id: 'tool', type: 'tool' });
  graph.addEdge({ id: 'edge', from: 'img', to: 'tool', port: 'image' });
  assert.equal(graph.stats().edges, 1);
  graph.edges.get('edge').line = { runtimeOnly: true };
  assert.deepEqual(graph.serialize()[0], {
    id: 'edge', from: 'img', to: 'tool', port: 'image', role: 'flow'
  });
  graph.syncNodes([{ id: 'img', type: 'image' }]);
  assert.deepEqual(graph.stats(), { nodes: 1, edges: 0 });
});

test('soft-goods nodes accept up to eight images for multi-view extraction', () => {
  const graph = new Core.GraphStore();
  graph.addNode({ id: 'soft', type: 'soft' });
  for (let i = 0; i < 9; i++) graph.addNode({ id: 'img' + i, type: 'image' });
  for (let i = 0; i < 8; i++) graph.addEdge({ from: 'img' + i, to: 'soft', port: 'image' });
  assert.equal(graph.inputCount('soft', 'image'), 8);
  assert.throws(
    () => graph.addEdge({ from: 'img8', to: 'soft', port: 'image' }),
    /输入端口已满/
  );
});

test('collapsed groups preserve boundary edges through proxy connections', () => {
  const members = new Set(['image', 'generator']);
  const edges = [
    { id: 'in', from: 'material', to: 'generator', port: 'material', role: 'material' },
    { id: 'inner', from: 'image', to: 'generator', port: 'structure', role: 'flow' },
    { id: 'out', from: 'generator', to: 'result', port: 'source', role: 'result' }
  ];
  assert.equal(Core.canConnect('image', 'collapsed', 'structure'), true);
  assert.equal(Core.canConnect('param', 'collapsed', 'params'), true);
  assert.equal(Core.canConnect('collapsed', 'generator', 'material'), true);
  assert.deepEqual(Core.collapsedInternalEdges(edges, members).map(edge => edge.id), ['inner']);
  assert.deepEqual(Core.collapsedBoundaryEdges(edges, members).map(edge => edge.id), ['in', 'out']);
  const proxies = Core.collapsedProxyEdges(edges, members, 'group');
  assert.equal(proxies.find(edge => edge.port === 'material').to, 'group');
  assert.equal(proxies.find(edge => edge.port === 'source').from, 'group');
  const restored = Core.collapsedRestoreEdges([edges[1]], Core.collapsedBoundaryEdges(edges, members));
  assert.deepEqual(restored.map(edge => edge.id).sort(), ['in', 'inner', 'out']);
});

test('pure graph core handles 2000 nodes and 2000 edges within budget', () => {
  const graph = new Core.GraphStore();
  const started = performance.now();
  for (let i = 0; i < 500; i++) {
    graph.addNode({ id: 'img' + i, type: 'image' });
    graph.addNode({ id: 'par' + i, type: 'param' });
    graph.addNode({ id: 'gen' + i, type: 'generator' });
    graph.addNode({ id: 'tool' + i, type: 'tool' });
  }
  for (let i = 0; i < 500; i++) {
    graph.addEdge({ from: 'img' + i, to: 'gen' + i, port: 'structure' });
    graph.addEdge({ from: 'par' + i, to: 'gen' + i, port: 'params' });
    graph.addEdge({ from: 'gen' + i, to: 'tool' + i, port: 'image' });
    graph.addEdge({ from: 'img' + i, to: 'tool' + i, port: 'reference' });
  }
  const elapsed = performance.now() - started;
  assert.deepEqual(graph.stats(), { nodes: 2000, edges: 2000 });
  assert.ok(elapsed < 2000, 'graph core took ' + Math.round(elapsed) + 'ms');
});
