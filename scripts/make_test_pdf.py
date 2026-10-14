#!/usr/bin/env python3
"""Generate a multi-page test PDF of synthetic Russian train tickets.

This mirrors the layout drawn by js/demo-ticket.js and the normalized boxes in
js/config.js (DEFAULT_CONFIG), so the app can OCR it out of the box. It is handy
for verifying multi-page PDF handling and the date/time parsing end-to-end.

Page 1 uses full "date + time" values; page 2 uses DATE-ONLY values, which is
the case that previously tripped the parser (a date like 27.10.2026 being read
as a time 27:10).

Usage:
    pip install pillow
    python scripts/make_test_pdf.py                 # -> test_two_page.pdf
    python scripts/make_test_pdf.py --out my.pdf --pages 2
"""
from __future__ import annotations

import argparse
import os

from PIL import Image, ImageDraw, ImageFont

PAGE_W, PAGE_H = 1000, 1414
SLOT_H = PAGE_H * 0.5  # matches slotOffsetY = 0.5 / slotsPerPage = 2

# Normalized SLOT-1 boxes — keep in sync with js/config.js DEFAULT_CONFIG.
BOXES = {
    "ticket_number": (0.585, 0.0389, 0.380, 0.034),
    "passenger": (0.245, 0.1025, 0.500, 0.032),
    "train": (0.315, 0.1626, 0.560, 0.030),
    "station_from": (0.035, 0.2298, 0.440, 0.030),
    "station_to": (0.515, 0.2298, 0.440, 0.030),
    "depart_datetime": (0.035, 0.3006, 0.400, 0.030),
    "price": (0.555, 0.3006, 0.175, 0.030),
}

LABELS = {
    "ticket_number": "Номер билета",
    "passenger": "Пассажир / ФИО",
    "train": "Поезд / Вагон / Место",
    "station_from": "Станция отправления",
    "station_to": "Станция назначения",
    "depart_datetime": "Дата и время отправления",
    "price": "Стоимость, руб.",
}

# Four distinct tickets: page 1 slots A/B, page 2 slots C/D.
TICKETS = [
    dict(number="70123456789012", passenger="ИВАНОВ ИВАН ИВАНОВИЧ",
         train="120Щ ВАГОН 07 МЕСТО 034", station_from="МОСКВА ОКТЯБРЬСКАЯ",
         station_to="САНКТ-ПЕТЕРБУРГ-ГЛ", depart="15.12.2026 09:40", price="4 567,80"),
    dict(number="70987654321098", passenger="ПЕТРОВА АННА СЕРГЕЕВНА",
         train="026А ВАГОН 12 МЕСТО 018", station_from="САНКТ-ПЕТЕРБУРГ-ГЛ",
         station_to="МОСКВА ОКТЯБРЬСКАЯ", depart="16.12.2026 21:15", price="3 980,00"),
    # Page 2: DATE-ONLY departure values (no time) — regression test.
    dict(number="70111222333444", passenger="СИДОРОВ ПЁТР АЛЕКСЕЕВИЧ",
         train="054М ВАГОН 03 МЕСТО 021", station_from="КАЗАНЬ ПАССАЖИРСКАЯ",
         station_to="МОСКВА КАЗАНСКАЯ", depart="27.10.2026", price="2 340,00"),
    dict(number="70555666777888", passenger="КУЗНЕЦОВА ОЛЬГА ПАВЛОВНА",
         train="702Ч ВАГОН 09 МЕСТО 012", station_from="МОСКВА КАЗАНСКАЯ",
         station_to="КАЗАНЬ ПАССАЖИРСКАЯ", depart="28.10.2026", price="2 410,50"),
]


def _load_font(candidates, size):
    for name in candidates:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _fonts():
    win = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
    bold = _load_font(
        [os.path.join(win, "arialbd.ttf"), "arialbd.ttf", "DejaVuSans-Bold.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"], 26)
    small = _load_font(
        [os.path.join(win, "arial.ttf"), "arial.ttf", "DejaVuSans.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"], 15)
    mono = _load_font(
        [os.path.join(win, "consola.ttf"), os.path.join(win, "cour.ttf"),
         "DejaVuSansMono.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"], 30)
    return bold, small, mono


def _px(box):
    x, y, w, h = box
    return x * PAGE_W, y * PAGE_H, w * PAGE_W, h * PAGE_H


def _draw_field(draw, top, key, value, bold, small, mono):
    bx, by, bw, bh = _px(BOXES[key])
    y = by + top
    font = mono if key == "ticket_number" else bold
    draw.text((bx + 2, y - 20), LABELS[key], font=small, fill=(107, 114, 128))
    draw.text((bx + 6, y + 4), value, font=font, fill=(17, 17, 17), anchor="la")


def _draw_ticket(draw, top, data, title, bold, small, mono):
    m = 20
    draw.rectangle([m, top + 10, PAGE_W - m, top + SLOT_H - 30], fill=(255, 255, 255),
                   outline=(30, 58, 138), width=2)
    draw.rectangle([m, top + 10, PAGE_W - m, top + 80], fill=(239, 246, 255),
                   outline=(30, 58, 138), width=2)
    draw.text((40, top + 22), "ЭЛЕКТРОННЫЙ БИЛЕТ / МАРШРУТНАЯ КВИТАНЦИЯ",
              font=bold, fill=(30, 58, 138), anchor="la")
    draw.text((40, top + 54), "ОАО «РЖД» · Форма ОБ · " + title, font=small,
              fill=(107, 114, 128))

    for key in ("ticket_number", "passenger", "train", "station_from",
                "station_to", "depart_datetime", "price"):
        _draw_field(draw, top, key, data[_src_key(key)], bold, small, mono)

    # "руб." suffix drawn just outside the (narrow) price box.
    pbx, pby, pbw, pbh = _px(BOXES["price"])
    draw.text((pbx + pbw + 10, pby + top + 4), "руб.", font=bold, fill=(17, 17, 17),
              anchor="la")


def _src_key(box_key):
    return {
        "ticket_number": "number",
        "passenger": "passenger",
        "train": "train",
        "station_from": "station_from",
        "station_to": "station_to",
        "depart_datetime": "depart",
        "price": "price",
    }[box_key]


def _render_page(tickets, page_no, total_pages, fonts):
    bold, small, mono = fonts
    img = Image.new("RGB", (PAGE_W, PAGE_H), (243, 244, 246))
    draw = ImageDraw.Draw(img)
    _draw_ticket(draw, 0, tickets[0], f"Билет 1 из 2 · стр. {page_no}/{total_pages}",
                 bold, small, mono)
    _draw_ticket(draw, int(SLOT_H), tickets[1], f"Билет 2 из 2 · стр. {page_no}/{total_pages}",
                 bold, small, mono)
    return img


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="test_two_page.pdf")
    ap.add_argument("--pages", type=int, default=2, choices=(1, 2))
    args = ap.parse_args()

    fonts = _fonts()
    pages = []
    pages.append(_render_page(TICKETS[0:2], 1, args.pages, fonts))
    if args.pages == 2:
        pages.append(_render_page(TICKETS[2:4], 2, args.pages, fonts))

    first, rest = pages[0], pages[1:]
    first.save(args.out, "PDF", resolution=150.0, save_all=True, append_images=rest)
    print(f"Wrote {args.out} ({len(pages)} page(s), {len(pages) * 2} tickets).")


if __name__ == "__main__":
    main()
