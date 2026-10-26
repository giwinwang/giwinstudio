(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GWWorkflowRuntime = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const TERMINAL_BLOCKERS = new Set(['failed', 'waiting', 'skipped', 'cancelled']);

  function normalizeScope(nodeIds, nodes) {
    const available = new Set((nodes || []).map(node => node && node.id).filter(Boolean));
    return Array.from(new Set((nodeIds || []).filter(id => available.has(id))));
  }

  function internalDependencies(nodeIds, edges) {
    const scope = new Set(nodeIds || []);
    const incoming = new Map();
    const outgoing = new Map();
    (nodeIds || []).forEach(id => {
      incoming.set(id, new Set());
      outgoing.set(id, new Set());
    });
    (edges || []).forEach(edge => {
      if (!edge || !scope.has(edge.from) || !scope.has(edge.to) || edge.from === edge.to) return;
      incoming.get(edge.to).add(edge.from);
      outgoing.get(edge.from).add(edge.to);
    });
    return {
      incoming: new Map([...incoming].map(([id, set]) => [id, [...set]])),
      outgoing: new Map([...outgoing].map(([id, set]) => [id, [...set]]))
    };
  }

  function topologicalOrder(nodeIds, edges) {
    const ids = Array.from(new Set(nodeIds || []));
    const graph = internalDependencies(ids, edges);
    const indegree = new Map(ids.map(id => [id, graph.incoming.get(id).length]));
    const queue = ids.filter(id => indegree.get(id) === 0);
    const order = [];
    while (queue.length) {
      const id = queue.shift();
      order.push(id);
      (graph.outgoing.get(id) || []).forEach(next => {
        const value = Math.max(0, (indegree.get(next) || 0) - 1);
        indegree.set(next, value);
        if (value === 0) queue.push(next);
      });
    }
    return {
      order,
      cycles: ids.filter(id => !order.includes(id)),
      incoming: graph.incoming,
      outgoing: graph.outgoing
    };
  }

  async function runDag(options = {}) {
    const nodes = options.nodes || [];
    const edges = options.edges || [];
    const nodeMap = new Map(nodes.map(node => [node && node.id, node]));
    const nodeIds = normalizeScope(options.nodeIds, nodes);
    const plan = topologicalOrder(nodeIds, edges);
    if (plan.cycles.length) {
      throw new Error('工作流存在循环依赖，无法自动运行：' + plan.cycles.join('、'));
    }
    const execute = typeof options.execute === 'function' ? options.execute : async () => ({ status: 'success' });
    const onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {};
    const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;
    const results = new Map();
    let cancelled = false;

    for (let index = 0; index < plan.order.length; index++) {
      if (shouldStop()) {
        cancelled = true;
        break;
      }
      const id = plan.order[index];
      const node = nodeMap.get(id) || { id };
      const dependencies = plan.incoming.get(id) || [];
      const blocker = dependencies.find(depId => {
        const dep = results.get(depId);
        return !dep || TERMINAL_BLOCKERS.has(dep.status);
      });
      let result;
      if (blocker) {
        const upstream = results.get(blocker);
        result = {
          status: 'skipped',
          message: '上游 ' + blocker + ' 未成功（' + ((upstream && upstream.status) || 'unknown') + '）'
        };
      } else if (node.executionMode === 'manual') {
        result = { status: 'waiting', message: node.manualReason || '等待人工操作' };
      } else {
        try {
          const value = await execute(node, {
            index,
            total: plan.order.length,
            dependencies,
            previous: Object.fromEntries(results)
          });
          result = value && typeof value === 'object'
            ? Object.assign({ status: 'success' }, value)
            : { status: 'success' };
        } catch (error) {
          result = {
            status: 'failed',
            message: error && error.message ? error.message : String(error)
          };
        }
      }
      result.nodeId = id;
      results.set(id, result);
      onEvent({
        type: 'node',
        index,
        total: plan.order.length,
        node,
        result
      });
    }

    if (cancelled) {
      plan.order.slice(results.size).forEach(id => {
        results.set(id, { nodeId: id, status: 'cancelled', message: '群组运行已取消' });
      });
    }
    const values = [...results.values()];
    const summary = values.reduce((counts, result) => {
      counts.total++;
      counts[result.status] = (counts[result.status] || 0) + 1;
      return counts;
    }, { total: values.length, success: 0, failed: 0, waiting: 0, skipped: 0, cancelled: 0 });
    return {
      ok: summary.failed === 0 && !cancelled,
      cancelled,
      order: plan.order,
      results: Object.fromEntries(results),
      summary
    };
  }

  return {
    normalizeScope,
    internalDependencies,
    topologicalOrder,
    runDag
  };
});
