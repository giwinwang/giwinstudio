# -*- coding: utf-8 -*-
# Phase 2b：阴影 token 化（修正版：0 Ypx Bpx color 两段长度格式）
import re
from collections import Counter

p = 'index.html'
text = open(p, encoding='utf-8').read()

def map_shadow(m):
    body = m.group(1)
    # 品牌蓝光晕（选中态）→ --glow
    if 'rgba(131,160,178' in body:
        return 'box-shadow:var(--glow)'
    m2 = re.match(r'^0 (?:0px )?(\d+)px', body)  # 0 Y B 或 0 0 B
    mm = re.match(r'^0 (\d+)px (\d+)px', body)
    if not mm: return m.group(0)
    blur = int(mm.group(2))
    if blur <= 8:    tok = 'var(--shadow-1)'
    elif blur <= 30: tok = 'var(--shadow-2)'
    else:            tok = 'var(--shadow-3)'
    return 'box-shadow:' + tok

pat = r'box-shadow:(0 [0-9]+px [0-9]+px(?: [0-9.]+px)? [^;}"]+)'
before = len(re.findall(pat, text))
text = re.sub(pat, map_shadow, text)

open(p, 'w', encoding='utf-8').write(text)
print('匹配单层投影:', before)
print('shadow token 引用:', text.count('var(--shadow-1)'), text.count('var(--shadow-2)'), text.count('var(--shadow-3)'))
print('glow 引用:', text.count('box-shadow:var(--glow)'))
rest = re.findall(r'box-shadow:[^;}"]+', text)
print('剩余声明:', len(rest))
c = Counter(x[:60] for x in rest)
for k, v in c.most_common(18):
    print(v, k)
