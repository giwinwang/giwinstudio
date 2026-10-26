// GIWIN Copilot · particle cube launch control
(() => {
  const button = document.getElementById('copilot-launch');
  const canvas = document.getElementById('copilot-cube-motion');
  if (!button || !canvas || button.hidden) return;

  const random = (() => {
    let seed = 9231;
    return () => {
      let value = seed += 0x6d2b79f5;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  })();

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (from, to, amount) => from + (to - from) * amount;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const particleCount = 260;
  const particles = [];

  function spherePoint(index, count) {
    const phi = Math.acos(1 - 2 * ((index + 0.5) / count));
    const theta = Math.PI * (1 + Math.sqrt(5)) * index;
    const radius = 0.86 + random() * 0.17;
    return {
      x: Math.cos(theta) * Math.sin(phi) * radius,
      y: Math.cos(phi) * radius,
      z: Math.sin(theta) * Math.sin(phi) * radius
    };
  }

  function cubePoint(index, count) {
    const edgeCount = Math.floor(count * 0.58);
    if (index < edgeCount) {
      const corners = [
        [-0.86, -0.86, -0.86], [0.86, -0.86, -0.86],
        [0.86, 0.86, -0.86], [-0.86, 0.86, -0.86],
        [-0.86, -0.86, 0.86], [0.86, -0.86, 0.86],
        [0.86, 0.86, 0.86], [-0.86, 0.86, 0.86]
      ];
      const edges = [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7]
      ];
      const edge = edges[index % edges.length];
      const amount = (index * 0.61803398875) % 1;
      const from = corners[edge[0]];
      const to = corners[edge[1]];
      return {
        x: lerp(from[0], to[0], amount),
        y: lerp(from[1], to[1], amount),
        z: lerp(from[2], to[2], amount),
        edge: true
      };
    }

    const faceCount = count - edgeCount;
    const side = Math.max(3, Math.ceil(Math.sqrt(faceCount / 6)));
    const faceCells = side * side;
    const totalCells = faceCells * 6;
    const cell = Math.floor((index - edgeCount) * totalCells / faceCount);
    const face = Math.floor(cell / faceCells);
    const local = cell % faceCells;
    const u = ((local % side) + 0.5) / side * 1.72 - 0.86;
    const v = (Math.floor(local / side) + 0.5) / side * 1.72 - 0.86;
    if (face === 0) return { x: -0.86, y: u, z: v };
    if (face === 1) return { x: 0.86, y: u, z: v };
    if (face === 2) return { x: u, y: -0.86, z: v };
    if (face === 3) return { x: u, y: 0.86, z: v };
    if (face === 4) return { x: u, y: v, z: -0.86 };
    return { x: u, y: v, z: 0.86 };
  }

  for (let index = 0; index < particleCount; index += 1) {
    particles.push({
      loose: spherePoint(index, particleCount),
      tight: cubePoint(index, particleCount),
      phase: random() * Math.PI * 2,
      speed: 0.4 + random() * 0.6,
      size: 0.68 + random() * 0.82,
      alpha: 0.4 + random() * 0.48
    });
  }

  class CopilotParticleCube {
    constructor() {
      this.context = canvas.getContext('2d');
      this.settle = 0;
      this.goal = 0;
      this.hovered = false;
      this.opened = false;
      this.hold = false;
      this.suspended = false;
      this.yaw = -0.46;
      this.targetYaw = -0.46;
      this.pitch = -0.28;
      this.targetPitch = -0.28;
      this.lastTime = performance.now();
      this.lastPaint = 0;
      this.lastPointerType = 'mouse';
      this.projectReady = Boolean(window.GWProjectState && window.GWProjectState.hasProject());
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
      this.resize();

      button.addEventListener('pointerenter', () => {
        this.hovered = true;
        this.setActive(true);
      });
      button.addEventListener('pointerover', () => {
        this.hovered = true;
        this.setActive(true);
      });
      button.addEventListener('pointermove', event => {
        if (!this.hovered) {
          this.hovered = true;
          this.setActive(true);
        }
        this.trackPointer(event);
      });
      button.addEventListener('pointerleave', () => {
        this.hovered = false;
        if (!this.opened && !this.hold) this.setActive(false);
      });
      button.addEventListener('pointerdown', event => {
        this.lastPointerType = event.pointerType || 'mouse';
      });
      button.addEventListener('click', event => {
        if (!this.projectReady) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.hold = true;
          this.setActive(true);
          if (window.toast) toast('请先新建或打开项目');
          return;
        }
        if (this.lastPointerType !== 'touch' || this.settle >= 0.7) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.hold = true;
        this.setActive(true);
      }, true);

      window.addEventListener('project-opened', () => {
        this.projectReady = true;
        this.hold = false;
        button.classList.add('is-project-ready');
    button.dataset.tip = '后续版本开放';
    button.setAttribute('aria-label', '粒子魔方，后续版本开放');
      });
      window.addEventListener('gw-canvas-activity', event => {
        this.setSuspended(Boolean(event.detail && event.detail.active));
      });

      requestAnimationFrame(time => this.draw(time));
    }

    setActive(active) {
      this.goal = active ? 1 : 0;
      button.setAttribute('data-cube-state', active ? 'active' : 'idle');
    }

    setSuspended(suspended) {
      this.suspended = Boolean(suspended);
      if (!this.suspended) this.lastTime = performance.now();
    }

    setOpen(open) {
      this.opened = Boolean(open);
      this.hold = Boolean(open);
      if (open) {
        this.setActive(true);
      } else {
        this.hovered = false;
        this.targetYaw = -0.46;
        this.targetPitch = -0.28;
        this.setActive(false);
      }
    }

    trackPointer(event) {
      const rect = button.getBoundingClientRect();
      const x = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      this.targetYaw = (x - 0.5) * Math.PI * 4;
      this.targetPitch = (y - 0.5) * Math.PI * 0.72 - 0.12;
    }

    resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      this.ratio = ratio;
    }

    draw(time) {
      if (this.opened || this.suspended || document.hidden) {
        setTimeout(() => requestAnimationFrame(next => this.draw(next)), 180);
        return;
      }

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) {
        requestAnimationFrame(next => this.draw(next));
        return;
      }
      const interactive = this.hovered || this.hold || Math.abs(this.goal - this.settle) > 0.01;
      if (!interactive && time - this.lastPaint < 1000 / 30) {
        requestAnimationFrame(next => this.draw(next));
        return;
      }
      this.lastPaint = time;

      const dt = Math.min(0.04, (time - this.lastTime) / 1000);
      this.lastTime = time;
      const speed = reducedMotion.matches ? 20 : 6.2;
      this.settle += (this.goal - this.settle) * (1 - Math.exp(-dt * speed));
      this.yaw += (this.targetYaw - this.yaw) * (1 - Math.exp(-dt * 8.5));
      this.pitch += (this.targetPitch - this.pitch) * (1 - Math.exp(-dt * 8.5));

      const elapsed = reducedMotion.matches ? 0 : time / 1000;
      const idleYaw = elapsed * 0.1;
      const yaw = lerp(idleYaw, this.yaw, this.settle);
      const pitch = lerp(-0.3 + Math.sin(elapsed * 0.18) * 0.07, this.pitch, this.settle);
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const cosX = Math.cos(pitch);
      const sinX = Math.sin(pitch);
      const ctx = this.context;
      ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;
      const projected = [];
      let maxExtent = 0.0001;

      for (const particle of particles) {
        const turbulence = (1 - this.settle) * 0.028;
        const x = lerp(particle.loose.x, particle.tight.x, this.settle)
          + Math.sin(elapsed * particle.speed + particle.phase) * turbulence;
        const y = lerp(particle.loose.y, particle.tight.y, this.settle)
          + Math.cos(elapsed * particle.speed * 0.83 + particle.phase) * turbulence;
        const z = lerp(particle.loose.z, particle.tight.z, this.settle);
        const rx = x * cosY - z * sinY;
        const rz = x * sinY + z * cosY;
        const ry = y * cosX - rz * sinX;
        const rz2 = y * sinX + rz * cosX;
        const perspective = 1 / Math.max(0.62, 1 + rz2 * 0.22);
        const rawX = rx * perspective;
        const rawY = ry * perspective;
        maxExtent = Math.max(maxExtent, Math.hypot(rawX, rawY));
        projected.push({ particle, rawX, rawY, perspective });
      }

      const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
      const colors = isDark
        ? { dot: '198,222,224', haze: '118,157,164' }
        : { dot: '44,57,61', haze: '131,160,178' };
      const extent = Math.min(width, height) * 0.37;
      const scale = extent / maxExtent;

      for (const item of projected) {
        const { particle, rawX, rawY, perspective } = item;
        const x = centerX + rawX * scale;
        const y = centerY + rawY * scale;
        const edgeBoost = particle.tight.edge ? this.settle * 0.55 : 0;
        const alpha = particle.alpha * (0.44 + 0.56 * perspective) * (1 + edgeBoost);
        const dot = particle.size * perspective * (1 + edgeBoost * 0.7);
        ctx.beginPath();
        ctx.fillStyle = `rgba(${colors.haze},${alpha * 0.14})`;
        ctx.arc(x, y, dot * 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = `rgba(${colors.dot},${alpha})`;
        ctx.arc(x, y, dot, 0, Math.PI * 2);
        ctx.fill();
      }

      requestAnimationFrame(next => this.draw(next));
    }
  }

  const motion = new CopilotParticleCube();
  button.classList.toggle('is-project-ready', motion.projectReady);
  button.dataset.tip = '后续版本开放';
  button.setAttribute('aria-label', '粒子魔方，后续版本开放');
  window.GWCopilotMotion = {
    setOpen(open) {
      motion.setOpen(open);
    },
    isAssembled() {
      return motion.settle >= 0.7;
    },
    reset() {
      motion.hold = false;
      motion.setActive(false);
    }
  };
})();
