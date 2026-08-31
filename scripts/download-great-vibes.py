import os
import re
import urllib.request

ROOT = os.path.join(os.path.dirname(__file__), "..", "fonts")
CSS_URL = "https://fonts.googleapis.com/css2?family=Great+Vibes&display=swap"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
FONTS_CSS = os.path.join(os.path.dirname(__file__), "..", "css", "fonts.css")

os.makedirs(ROOT, exist_ok=True)

req = urllib.request.Request(CSS_URL, headers={"User-Agent": UA})
css = urllib.request.urlopen(req).read().decode("utf-8")

face_pattern = re.compile(r"@font-face\s*\{([^}]+)\}", re.MULTILINE | re.DOTALL)
new_blocks = []

for match in face_pattern.finditer(css):
    block = match.group(1)
    src = re.search(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", block)
    if not src:
        continue

    url = src.group(1)
    fname = url.split("/")[-1]
    local = os.path.join(ROOT, fname)
    if not os.path.exists(local):
        urllib.request.urlretrieve(url, local)

    family = re.search(r"font-family:\s*'([^']+)'", block)
    style = re.search(r"font-style:\s*(\w+)", block)
    weight = re.search(r"font-weight:\s*(\d+)", block)
    display = re.search(r"font-display:\s*(\w+)", block)
    unicode_range = re.search(r"unicode-range:\s*([^;]+);", block)

    lines = [
        "@font-face {",
        f"  font-family: '{family.group(1)}';",
        f"  font-style: {style.group(1) if style else 'normal'};",
        f"  font-weight: {weight.group(1) if weight else '400'};",
        f"  font-display: {display.group(1) if display else 'swap'};",
    ]
    if unicode_range:
        lines.append(f"  unicode-range: {unicode_range.group(1).strip()};")
    lines.append(f"  src: url('../fonts/{fname}') format('woff2');")
    lines.append("}")
    new_blocks.append("\n".join(lines))

with open(FONTS_CSS, "a", encoding="utf-8") as handle:
    if new_blocks:
        handle.write("\n\n/* Great Vibes */\n\n")
        handle.write("\n\n".join(new_blocks))
        handle.write("\n")

print(f"Appended {len(new_blocks)} Great Vibes @font-face rule(s)")
for block in new_blocks:
    print(block.split("\n")[1])
