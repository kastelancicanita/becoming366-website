import os
import re
import urllib.request

ROOT = os.path.join(os.path.dirname(__file__), "..", "fonts")
CSS_URL = (
    "https://fonts.googleapis.com/css2?"
    "family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500;1,600&"
    "family=DM+Sans:wght@300;400;500;600&display=swap"
)
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

os.makedirs(ROOT, exist_ok=True)

req = urllib.request.Request(CSS_URL, headers={"User-Agent": UA})
css = urllib.request.urlopen(req).read().decode("utf-8")

face_pattern = re.compile(
    r"@font-face\s*\{([^}]+)\}",
    re.MULTILINE | re.DOTALL,
)

css_blocks = []

for match in face_pattern.finditer(css):
    block = match.group(1)

    family = re.search(r"font-family:\s*'([^']+)'", block)
    style = re.search(r"font-style:\s*(\w+)", block)
    weight = re.search(r"font-weight:\s*(\d+)", block)
    display = re.search(r"font-display:\s*(\w+)", block)
    unicode_range = re.search(r"unicode-range:\s*([^;]+);", block)
    src = re.search(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", block)

    if not (family and style and weight and src):
        continue

    url = src.group(1)
    fname = url.split("/")[-1]
    local = os.path.join(ROOT, fname)

    if not os.path.exists(local):
        urllib.request.urlretrieve(url, local)

    lines = [
        "@font-face {",
        f"  font-family: '{family.group(1)}';",
        f"  font-style: {style.group(1)};",
        f"  font-weight: {weight.group(1)};",
        f"  font-display: {display.group(1) if display else 'swap'};",
    ]

    if unicode_range:
        lines.append(f"  unicode-range: {unicode_range.group(1).strip()};")

    lines.append(f"  src: url('../fonts/{fname}') format('woff2');")
    lines.append("}")
    css_blocks.append("\n".join(lines))

fonts_css = os.path.join(os.path.dirname(__file__), "..", "css", "fonts.css")
with open(fonts_css, "w", encoding="utf-8") as handle:
    handle.write("\n\n".join(css_blocks) + "\n")

unique_files = sorted({os.path.basename(path) for path in os.listdir(ROOT) if path.endswith(".woff2")})
print(f"Font files: {len(unique_files)}")
print(f"@font-face rules: {len(css_blocks)}")
print(f"Wrote {fonts_css}")
