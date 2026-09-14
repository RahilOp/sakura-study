#!/usr/bin/env python3
"""Convert notes/**/*.md to notes/**/*.html for the app to load."""
import os
import re
from pathlib import Path

try:
    import markdown
except ImportError:
    raise SystemExit("Install markdown: pip install markdown")

ROOT = Path(__file__).parent.parent
NOTES = ROOT / "notes"

md = markdown.Markdown(extensions=["tables", "fenced_code", "nl2br"])

for md_path in sorted(NOTES.rglob("*.md")):
    html_path = md_path.with_suffix(".html")
    text = md_path.read_text(encoding="utf-8")
    md.reset()
    html = md.convert(text)
    # wrap tables for horizontal scroll on small screens
    html = re.sub(r"<table>", r'<div class="table-wrap"><table>', html)
    html = re.sub(r"</table>", r"</table></div>", html)
    # markdown --- becomes <hr />: use it as a page break marker
    html = html.replace("<hr />", '<hr class="page-break" />')
    out = '<div class="notes-html">' + html + "</div>"
    html_path.write_text(out, encoding="utf-8")
    print(f"{md_path.relative_to(ROOT)} -> {html_path.relative_to(ROOT)}")

print("Done.")
