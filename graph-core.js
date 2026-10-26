(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GWGraphCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const SCHEMA_VERSION = 3;
  const PORT = Object.freeze({
    MEDIA: 'media',
    PARAMS: 'params',
    MATERIAL: 'material',
    LIGHT: 'light',
    SOFT: 'soft',
    PAGES: 'pages',
    PROMPT: 'prompt'
  });
  const COLLAPSED_PORTS = Object.freeze([
    ['source', PORT.MEDIA],
    ['structure', PORT.MEDIA],
    ['style', PORT.MEDIA],
    ['image', PORT.MEDIA],
    ['reference', PORT.MEDIA],
    ['images', PORT.MEDIA],
    ['a', PORT.MEDIA],
    ['b', PORT.MEDIA],
    ['media', PORT.MEDIA],
    ['params', PORT.PARAMS],
    ['material', PORT.MATERIAL],
    ['light', PORT.LIGHT],
    ['soft', PORT.SOFT],
    ['prompt', PORT.PROMPT]
  ]);

  const NODE_DEFS = Object.freeze({
    image: {
      title: '图片',
      inputs: [{ id: 'source', type: PORT.MEDIA, required: false, max: 1 }],
      outputs: [{ id: 'out', type: PORT.MEDIA }]
    },
    variant: {
      title: '生成结果',
      inputs: [],
      outputs: [{ id: 'out', type: PORT.MEDIA }]
    },
    generator: {
      title: '图片生成',
      inputs: [
        { id: 'structure', type: PORT.MEDIA, required: true, max: 5 },
        { id: 'prompt', type: PORT.PROMPT, required: false, max: 1 },
        { id: 'style', type: PORT.MEDIA, required: false, max: 1 },
        { id: 'params', type: PORT.PARAMS, required: false, max: 1 },
        { id: 'material', type: PORT.MATERIAL, required: false, max: 1 },
        { id: 'light', type: PORT.LIGHT, required: false, max: 1 }
      ],
      outputs: [{ id: 'result', type: PORT.MEDIA }]
    },
    param: {
      title: '参数控制',
      inputs: [],
      outputs: [{ id: 'params', type: PORT.PARAMS }]
    },
    material: {
      title: '空间材质',
      inputs: [{ id: 'reference', type: PORT.MEDIA, required: false, max: 4 }],
      outputs: [{ id: 'material', type: PORT.MATERIAL }]
    },
    light: {
      title: '光影参数',
      inputs: [],
      outputs: [{ id: 'light', type: PORT.LIGHT }]
    },
    tool: {
      title: '图像编辑',
      inputs: [
        { id: 'image', type: PORT.MEDIA, required: true, max: 4 },
        { id: 'reference', type: PORT.MEDIA, required: false, max: 1 },
        { id: 'params', type: PORT.PARAMS, required: false, max: 1 },
        { id: 'material', type: PORT.MATERIAL, required: false, max: 1 }
      ],
      outputs: [
        { id: 'result', type: PORT.MEDIA },
        { id: 'prompt', type: PORT.PROMPT }
      ]
    },
    video: {
      title: '视频生成',
      inputs: [
        { id: 'images', type: PORT.MEDIA, required: true, max: 8 },
        { id: 'params', type: PORT.PARAMS, required: false, max: 1 }
      ],
      outputs: [{ id: 'video', type: PORT.MEDIA }]
    },
    panorama: {
      title: '360° 全景预览',
      inputs: [{ id: 'image', type: PORT.MEDIA, required: true, max: 1 }],
      outputs: [{ id: 'preview', type: PORT.MEDIA }]
    },
    soft: {
      title: '软装集合',
      inputs: [{ id: 'image', type: PORT.MEDIA, required: true, max: 8 }],
      outputs: [{ id: 'soft', type: PORT.SOFT }]
    },
    layout: {
      title: '版式输出',
      inputs: [
        { id: 'media', type: PORT.MEDIA, required: false, max: Infinity },
        { id: 'soft', type: PORT.SOFT, required: false, max: Infinity }
      ],
      outputs: [{ id: 'pages', type: PORT.PAGES }]
    },
    collapsed: {
      title: 'Collapsed group',
      inputs: COLLAPSED_PORTS.map(([id, type]) => ({ id, type, max: Infinity })),
      outputs: COLLAPSED_PORTS.map(([id, type]) => ({ id, type }))
    },
    compare: {
      title: '图像对比',
      inputs: [
        { id: 'a', type: PORT.MEDIA, required: true, max: 1 },
        { id: 'b', type: PORT.MEDIA, required: true, max: 1 }
      ],
      outputs: []
    },
    note: {
      title: '便签',
      inputs: [],
      outputs: []
    },
    error: {
      title: '失败结果',
      inputs: [],
      outputs: []
    }
  });

  function getNodeDef(type) {
    return NODE_DEFS[type] || null;
  }

  function resolvePort(type, portId, direction) {
    const def = getNodeDef(type);
    if (!def) return null;
    const ports = direction === 'in' ? def.inputs : def.outputs;
    return portId ? ports.find(port => port.id === portId) || null : ports[0] || null;
  }

  function canConnect(fromType, toType, toPortId) {
    if (!fromType || !toType) return false;
    const fromDef = getNodeDef(fromType);
    const input = resolvePort(toType, toPortId, 'in');
    if (!fromDef || !input) return false;
    return fromDef.outputs.some(output => output.type === input.type);
  }

  function collapsedBoundaryEdges(edges, memberIds) {
    const members = memberIds instanceof Set ? memberIds : new Set(memberIds || []);
    return (edges || [])
      .filter(edge => edge && members.has(edge.from) !== members.has(edge.to))
      .map(edge => Object.assign({}, edge));
  }

  function collapsedInternalEdges(edges, memberIds) {
    const members = memberIds instanceof Set ? memberIds : new Set(memberIds || []);
    return (edges || [])
      .filter(edge => edge && members.has(edge.from) && members.has(edge.to))
      .map(edge => Object.assign({}, edge));
  }

  function collapsedProxyEdges(edges, memberIds, collapsedId) {
    const members = memberIds instanceof Set ? memberIds : new Set(memberIds || []);
    if (!collapsedId) return [];
    return (edges || [])
      .filter(edge => edge && members.has(edge.from) !== members.has(edge.to))
      .map(edge => ({
        id: (edge.id || 'edge') + '::collapsed::' + collapsedId,
        from: members.has(edge.from) ? collapsedId : edge.from,
        to: members.has(edge.to) ? collapsedId : edge.to,
        port: edge.port,
        role: edge.role || 'flow'
      }));
  }

  function collapsedRestoreEdges(internalEdges, boundaryEdges) {
    const byId = new Map();
    (internalEdges || []).concat(boundaryEdges || []).forEach(edge => {
      if (!edge || !edge.from || !edge.to) return;
      const key = edge.id || (edge.from + '>' + edge.to + ':' + (edge.port || ''));
      if (!byId.has(key)) byId.set(key, Object.assign({}, edge));
    });
    return [...byId.values()];
  }

  class GraphStore {
    constructor() {
      this.nodes = new Map();
      this.edges = new Map();
      this.outgoing = new Map();
      this.incoming = new Map();
      this.inputCounts = new Map();
    }

    addNode(node) {
      if (!node || !node.id) throw new Error('节点缺少 id');
      if (this.nodes.has(node.id)) throw new Error('节点 id 重复：' + node.id);
      this.nodes.set(node.id, Object.assign({}, node));
      this.outgoing.set(node.id, new Set());
      this.incoming.set(node.id, new Set());
      return node.id;
    }

    syncNodes(records) {
      const seen = new Set();
      (records || []).forEach(record => {
        if (!record || !record.id || !record.type) return;
        seen.add(record.id);
        if (!this.nodes.has(record.id)) {
          this.nodes.set(record.id, { id: record.id, type: record.type });
          this.outgoing.set(record.id, new Set());
          this.incoming.set(record.id, new Set());
        } else {
          const existing = this.nodes.get(record.id);
          existing.type = record.type;
        }
      });
      for (const id of [...this.nodes.keys()]) {
        if (!seen.has(id)) this.removeNode(id);
      }
      for (const edge of [...this.edges.values()]) {
        if (!seen.has(edge.from) || !seen.has(edge.to)) this.removeEdge(edge.id);
      }
    }

    removeNode(nodeId) {
      if (!this.nodes.has(nodeId)) return false;
      this.nodes.delete(nodeId);
      for (const edge of [...this.edges.values()]) {
        if (edge.from === nodeId || edge.to === nodeId) this.removeEdge(edge.id);
      }
      this.outgoing.delete(nodeId);
      this.incoming.delete(nodeId);
      return true;
    }

    inputCount(nodeId, portId) {
      return this.inputCounts.get(nodeId + '|' + (portId || '')) || 0;
    }

    wouldCreateCycle(fromId, toId) {
      const seen = new Set();
      const walk = id => {
        if (id === fromId) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        for (const edgeId of this.outgoing.get(id) || []) {
          const edge = this.edges.get(edgeId);
          if (edge && walk(edge.to)) return true;
        }
        return false;
      };
      return walk(toId);
    }

    addEdge(edge) {
      if (!edge || !edge.from || !edge.to) throw new Error('连线缺少起点或终点');
      if (edge.from === edge.to) throw new Error('不能连接节点自身');
      const from = this.nodes.get(edge.from);
      const to = this.nodes.get(edge.to);
      if (!from || !to) throw new Error('连线引用了不存在的节点');
      const portId = edge.port || '';
      const input = resolvePort(to.type, portId, 'in');
      if (!input || !canConnect(from.type, to.type, input.id)) {
        throw new Error('端口类型不兼容');
      }
      const max = input.max == null ? 1 : input.max;
      if (this.inputCount(to.id, input.id) >= max) throw new Error('输入端口已满');
      if (this.wouldCreateCycle(from.id, to.id)) throw new Error('连接会形成循环');
      const duplicate = [...(this.outgoing.get(edge.from) || [])].some(edgeId => {
        const existing = this.edges.get(edgeId);
        return existing && existing.to === edge.to && existing.port === input.id;
      });
      if (duplicate) return null;
      const id = edge.id || 'edge-' + this.edges.size + '-' + Date.now().toString(36);
      const record = {
        id,
        from: edge.from,
        to: edge.to,
        port: input.id,
        role: edge.role || 'flow'
      };
      this.edges.set(id, record);
      this.outgoing.get(record.from).add(id);
      this.incoming.get(record.to).add(id);
      const countKey = record.to + '|' + record.port;
      this.inputCounts.set(countKey, (this.inputCounts.get(countKey) || 0) + 1);
      return id;
    }

    removeEdge(edgeId) {
      const edge = this.edges.get(edgeId);
      if (!edge) return false;
      this.edges.delete(edgeId);
      this.outgoing.get(edge.from)?.delete(edgeId);
      this.incoming.get(edge.to)?.delete(edgeId);
      const countKey = edge.to + '|' + edge.port;
      const next = Math.max(0, (this.inputCounts.get(countKey) || 1) - 1);
      if (next) this.inputCounts.set(countKey, next); else this.inputCounts.delete(countKey);
      return true;
    }

    edgesFor(nodeId) {
      return [...this.edges.values()].filter(edge => edge.from === nodeId || edge.to === nodeId);
    }

    serialize() {
      return [...this.edges.values()].map(edge => ({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        port: edge.port,
        role: edge.role
      }));
    }

    load(edges) {
      this.edges.clear();
      this.outgoing.forEach(set => set.clear());
      this.incoming.forEach(set => set.clear());
      this.inputCounts.clear();
      (edges || []).forEach(edge => {
        try { this.addEdge(edge); } catch (e) { console.warn('[graph] 跳过非法连线', edge, e.message); }
      });
    }

    stats() {
      return { nodes: this.nodes.size, edges: this.edges.size };
    }
  }

  function migrateCanvasState(input) {
    if (!input || typeof input !== 'object') return input;
    const state = JSON.parse(JSON.stringify(input));
    const fromVersion = Number(state.version || 1);
    if (!Array.isArray(state.nodes)) state.nodes = [];
    if (!Array.isArray(state.edges)) state.edges = [];
    state.nodes.forEach(node => {
      if (!node || typeof node !== 'object') return;
      if (!node.id) node.id = 'migrated-' + Math.random().toString(36).slice(2, 10);
      if (!node.type) node.type = 'image';
    });
    state.stage = Object.assign({ x: 0, y: 0, scale: 1 }, state.stage || {});
    state.rooms = state.rooms && typeof state.rooms === 'object' ? state.rooms : {};
    state.version = SCHEMA_VERSION;
    state.migratedFrom = fromVersion !== SCHEMA_VERSION ? fromVersion : undefined;
    return state;
  }

  return {
    SCHEMA_VERSION,
    PORT,
    NODE_DEFS,
    GraphStore,
    getNodeDef,
    resolvePort,
    canConnect,
    COLLAPSED_PORTS,
    collapsedBoundaryEdges,
    collapsedInternalEdges,
    collapsedProxyEdges,
    collapsedRestoreEdges,
    migrateCanvasState
  };
});
