#!/usr/bin/env python3
"""
Scrapling wrapper for inloop.

Usage: python3 scrape.py <url> <extract_mode>

Extract modes:
  - headlines: Extract h1-h3 tags and article titles with links
  - full: Extract full page text content
  - links: Extract all links with text

Outputs JSON to stdout.
"""

import sys
import json

try:
    from scrapling import Fetcher, StealthFetcher
except ImportError:
    print(json.dumps({
        "url": sys.argv[1] if len(sys.argv) > 1 else "",
        "headlines": [],
        "error": "Scrapling not installed. Run: pip install scrapling"
    }))
    sys.exit(1)


def extract_headlines(page):
    """Extract headlines and article titles."""
    headlines = []

    # Try common headline selectors
    selectors = [
        "h1", "h2", "h3",
        "article h1", "article h2",
        ".post-title", ".entry-title", ".article-title",
        "[class*='headline']", "[class*='title']",
    ]

    seen_texts = set()
    for selector in selectors:
        try:
            elements = page.css(selector)
            for el in elements:
                text = el.text.strip()
                if text and text not in seen_texts and len(text) > 10:
                    seen_texts.add(text)
                    link = None
                    # Check if element or parent has a link
                    a_tag = el.css("a")
                    if a_tag:
                        link = a_tag[0].attrib.get("href", None)
                    elif el.tag == "a":
                        link = el.attrib.get("href", None)
                    headlines.append({"text": text, "link": link})
        except Exception:
            continue

    return headlines


def extract_full_text(page):
    """Extract full page text content."""
    # Remove script and style elements
    for tag in ["script", "style", "nav", "footer", "header"]:
        try:
            for el in page.css(tag):
                el.remove()
        except Exception:
            pass

    return page.text.strip()


def extract_links(page):
    """Extract all links with text."""
    links = []
    seen_hrefs = set()

    for a in page.css("a[href]"):
        href = a.attrib.get("href", "").strip()
        text = a.text.strip()
        if href and text and href not in seen_hrefs and not href.startswith("#"):
            seen_hrefs.add(href)
            links.append({"text": text, "href": href})

    return links


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: scrape.py <url> [headlines|full|links]"}))
        sys.exit(1)

    url = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else "headlines"

    result = {"url": url, "headlines": [], "fullText": None, "links": []}

    try:
        # Use StealthFetcher for anti-bot sites, fall back to regular Fetcher
        try:
            fetcher = StealthFetcher()
            page = fetcher.get(url)
        except Exception:
            fetcher = Fetcher()
            page = fetcher.get(url)

        if mode == "headlines":
            result["headlines"] = extract_headlines(page)
        elif mode == "full":
            result["fullText"] = extract_full_text(page)
        elif mode == "links":
            result["links"] = extract_links(page)

    except Exception as e:
        result["error"] = str(e)

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
