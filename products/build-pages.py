#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Короткие адреса продуктов: products/<slug>/index.html — копия products/p/index.html с OG-тегами товара.

Telegram и другие соцсети не выполняют JS, поэтому превью берётся из статичных тегов. Карточка по короткому
адресу работает так же, как /products/p/?s=<slug>: slug берётся из пути. Запуск после добавления или
переименования товара: python3 products/build-pages.py (берёт активные товары из каталога API).
"""
import html
import json
import re
import urllib.request
from pathlib import Path

API = 'https://functions.yandexcloud.net/d4eh4qtc4a7fria6mgmt'
HERE = Path(__file__).resolve().parent
RESERVED = {'p', 'order', 'og'}
OG_RE = re.compile(r'  <title>.*?</title>\n(?:  <meta (?:property="og:|name="twitter:)[^\n]*\n)*', re.S)


def first_sentence(md, limit=200):
    text = re.sub(r'\s+', ' ', re.sub(r'[*_#`>\[\]]', '', md or '')).strip()
    m = re.match(r'(.+?[.!?])(\s|$)', text)
    s = m.group(1) if m else text
    return s if len(s) <= limit else s[:limit - 1].rstrip() + '…'


def main():
    with urllib.request.urlopen(f'{API}?a=catalog&kind=digital', timeout=30) as r:
        products = json.load(r)['products']
    tpl = (HERE / 'p' / 'index.html').read_text(encoding='utf-8')
    assert OG_RE.search(tpl), 'в products/p/index.html нет блока <title> + og-тегов'
    for p in products:
        slug = p['id']
        if slug in RESERVED:
            print(f'пропуск {slug}: имя занято служебной папкой')
            continue
        with urllib.request.urlopen(f'{API}?a=product&s={slug}', timeout=30) as r:  # в каталоге нет описания
            p = json.load(r)['product']
        t, d = html.escape(p['title']), html.escape(first_sentence(p.get('description_md')))
        img = html.escape((p.get('image_urls') or ['https://antiosov.ru/assets/og-words.png'])[0])
        url = f'https://antiosov.ru/products/{slug}/'
        head = (f'  <title>{t} — Дмитрий Антиосов</title>\n'
                f'  <meta name="description" content="{d}" />\n'
                f'  <meta property="og:type" content="website" />\n'
                f'  <meta property="og:url" content="{url}" />\n'
                f'  <meta property="og:title" content="{t}" />\n'
                f'  <meta property="og:description" content="{d}" />\n'
                f'  <meta property="og:image" content="{img}" />\n'
                f'  <meta property="og:locale" content="ru_RU" />\n'
                f'  <meta property="og:site_name" content="Антиосов" />\n'
                f'  <meta name="twitter:card" content="summary_large_image" />\n')
        out = HERE / slug / 'index.html'
        out.parent.mkdir(exist_ok=True)
        out.write_text(OG_RE.sub(lambda _: head, tpl, count=1), encoding='utf-8')
        print(f'{out.relative_to(HERE.parent)}: {p["title"]}')


if __name__ == '__main__':
    main()
