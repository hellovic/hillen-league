#!/usr/bin/env python3
"""Generate the Open Graph share image (dashboard/og.png, 1200x630)."""
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
TOP = (13, 18, 32)      # #0d1220
BOT = (30, 39, 69)      # #1e2745
ACCENT = (252, 99, 6)   # #fc6306
ACCENT2 = (179, 64, 0)  # #b34000
TXT = (232, 236, 245)   # #e8ecf5
MUTED = (139, 150, 181) # #8b96b5

FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
FONT_REG = "/System/Library/Fonts/Supplemental/Arial.ttf"


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vertical_gradient(size, top, bottom):
    img = Image.new("RGB", size)
    d = ImageDraw.Draw(img)
    for y in range(size[1]):
        d.line([(0, y), (size[0], y)], fill=lerp(top, bottom, y / (size[1] - 1)))
    return img


def main():
    img = vertical_gradient((W, H), TOP, BOT)
    d = ImageDraw.Draw(img)

    # logo chip: rounded rect with accent gradient
    chip_x0, chip_y0, chip_x1, chip_y1 = 90, 200, 210, 320
    for yy in range(chip_y0, chip_y1):
        t = (yy - chip_y0) / (chip_y1 - chip_y0)
        d.line([(chip_x0, yy), (chip_x1, yy)], fill=lerp(ACCENT, ACCENT2, t))
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle([chip_x0, chip_y0, chip_x1, chip_y1],
                                            radius=28, fill=255)
    grad = vertical_gradient((W, H), ACCENT, ACCENT2)
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)
    logo_font = ImageFont.truetype(FONT_BOLD, 66)
    hl = "HL"
    bbox = logo_font.getbbox(hl)  # (x0, y0, x1, y1)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    cx, cy = (chip_x0 + chip_x1) / 2, (chip_y0 + chip_y1) / 2
    d.text((cx - tw / 2 - bbox[0], cy - th / 2 - bbox[1]), hl, font=logo_font, fill=(255, 255, 255))

    title_font = ImageFont.truetype(FONT_BOLD, 92)
    sub_font = ImageFont.truetype(FONT_REG, 44)
    d.text((250, 220), "Hillen League", font=title_font, fill=TXT)
    d.text((250, 330), "Youth Girls Basketball Dashboard", font=sub_font, fill=MUTED)

    img.save("dashboard/og.png")
    print("wrote dashboard/og.png", img.size)


if __name__ == "__main__":
    main()
