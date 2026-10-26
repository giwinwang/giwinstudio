# -*- coding: utf-8 -*-
# Phase 2：字号收敛(A) + 阴影token(J) + 间距栅格(F) + 角标规格(I) + 动效/禁用态(G)
import re, sys

p = 'index.html'
text = open(p, encoding='utf-8').read()

# ── A. 字号收敛：五档 10.5/11/12/13/15（>=16 保持）──
def map_font(m):
    v = float(m.group(1))
    if v <= 10.25: return 'font-size:10.5px'   # 6~10 → 10.5
    if v <= 11.25: return 'font-size:11px'     # 10.5~11.2 → 11（11.5 归 12）
    if v <= 12.2:  return 'font-size:12px'
    if v <= 13.2:  return 'font-size:13px'
    if v <= 14.5:  return 'font-size:15px'     # 14 → 15
    return m.group(0)                          # 15+ 保持
text = re.sub(r'font-size:([0-9.]+)px', map_font, text)

# ── J. 阴影 token 化：纯单层投影按模糊半径归档；选中光晕归 --glow ──
def map_shadow(m):
    body = m.group(1)
    # 选中光晕（品牌蓝 glow）→ --glow
    if 'rgba(131,160,178' in body and re.search(r'0 0 \d+px', body):
        return 'box-shadow:var(--glow)'
    m2 = re.match(r'^0 (\d+)px (\d+)px (\d+)px (.+)$', body)
    if not m2: return m.group(0)
    blur = int(m2.group(3))
    if blur <= 8:   tok = 'var(--shadow-1)'
    elif blur <= 30: tok = 'var(--shadow-2)'
    else:            tok = 'var(--shadow-3)'
    return 'box-shadow:' + tok
text = re.sub(r'box-shadow:(0 [0-9]+px [0-9]+px [0-9]+px [^;}"]+)', map_shadow, text)

# ── G. 过渡时长两档：<=.18s → var(--dur-fast) 对应 .15s；>.18s → .22s ──
def map_dur(m):
    v = float(m.group(1))
    return m.group(0).replace(m.group(1)+'s', '.15s') if v <= 0.18 else m.group(0).replace(m.group(1)+'s', '.22s')
text = re.sub(r'transition:[^;}"]+', lambda m: re.sub(r'([0-9.]+)s', map_dur, m.group(0)), text)

# ── F. gap / padding 收敛 4px 栅格 ──
def snap4(v):
    v = float(v)
    if v <= 2.5: return int(v)      # 2px 光学间距保留
    table = [4, 8, 12, 16, 20, 24, 32]
    best = min(table, key=lambda t: (abs(t - v), t))
    return best
def snap_val(m):
    return m.group(1) + str(snap4(m.group(2))) + 'px'
n0 = len(text)
text = re.sub(r'(gap:)([0-9.]+)px', snap_val, text)
text = re.sub(r'(gap:)([0-9.]+)px', snap_val, text)  # gap:8px 12px 形式第二段
text = re.sub(r'(padding:)([0-9.]+)px ([0-9.]+)px([;) ])', lambda m: f'{m.group(1)}{snap4(m.group(2))}px {snap4(m.group(3))}px{m.group(4)}', text)
text = re.sub(r'(padding:)([0-9.]+)px([;)])', lambda m: f'{m.group(1)}{snap4(m.group(2))}px{m.group(3)}', text)
text = re.sub(r'(padding(?:-top|-right|-bottom|-left):)([0-9.]+)px', snap_val, text)

# ── I. 角标规格统一 ──
text = text.replace(
  ".license-settings-badge { padding:3px 7px; border:1px solid var(--line); border-radius:999px; color:var(--sub); font-size:9px; line-height:1; }",
  ".license-settings-badge { display:inline-flex; align-items:center; height:18px; padding:0 8px; border:1px solid var(--line); border-radius:999px; color:var(--sub); font-size:10.5px; }")
text = text.replace(
  "flex:none; height:24px; padding:0 9px;",
  "flex:none; height:20px; padding:0 9px;")
text = text.replace(
  ".gen-camera-badge { position:absolute; left:4px; top:4px; width:18px; height:18px; border-radius:6px; background:var(--brand-strong); color:#fff; border:1px solid var(--panel); font-size:10px; font-weight:700; line-height:16px; text-align:center; z-index:2; box-shadow:var(--shadow-1); }",
  ".gen-camera-badge { position:absolute; left:5px; top:5px; min-width:18px; height:18px; padding:0 5px; border-radius:6px; background:var(--brand-strong); color:#fff; border:1px solid var(--panel); font-size:10px; font-weight:700; display:inline-flex; align-items:center; justify-content:center; z-index:2; box-shadow:var(--shadow-1); }")
text = text.replace(
  ".asset-favorite { display:inline-block; margin-left:4px; padding:1px 4px; border:1px solid rgba(131,160,178,.55); border-radius:4px; color:#83A0B2; font-size:8px; line-height:11px; vertical-align:1px; }",
  ".asset-favorite { display:inline-flex; align-items:center; margin-left:4px; height:16px; padding:0 6px; border:1px solid rgba(131,160,178,.5); border-radius:999px; color:var(--brand); font-size:10px; vertical-align:1px; }")

open(p, 'w', encoding='utf-8').write(text)
print('Phase2 完成')
# 汇报
fs = re.findall(r'font-size:([0-9.]+)px', text)
from collections import Counter
print('字号档位:', sorted(Counter(fs).items(), key=lambda x: float(x[0])))
print('阴影 token 引用:', text.count('var(--shadow-'), '| glow 引用:', text.count('var(--glow'), '| dur 引用:', text.count('var(--dur'), '+.15s/.22s 内联')
print('剩余 box-shadow 声明:', len(re.findall(r'box-shadow:', text)))
