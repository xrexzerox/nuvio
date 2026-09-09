from PIL import Image, ImageDraw, ImageFont
import random

W, H = 1024, 576
CATEGORIES = ['netflix', 'hbo', 'prime', 'appletv', 'anime', 'horror', 'drama', 'korean', 'kids']
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

for index, name in enumerate(CATEGORIES):
    rng = random.Random(20260909 + index)
    img = Image.new('RGB', (W, H), (0, 0, 0))
    draw = ImageDraw.Draw(img)
    text = name.upper()

    size = 150
    while True:
        font = ImageFont.truetype(FONT, size)
        box = draw.textbbox((0, 0), text, font=font, stroke_width=1)
        if box[2] - box[0] <= W - 100:
            break
        size -= 2

    tw, th = box[2] - box[0], box[3] - box[1]
    x = (W - tw) // 2 - box[0]
    y = (H - th) // 2 - box[1]

    # Main bold white lettering.
    draw.text((x, y), text, font=font, fill=(238, 238, 238), stroke_width=1, stroke_fill=(245, 245, 245))

    # Stone/grunge speckles clipped to the lettering mask.
    mask = Image.new('L', (W, H), 0)
    md = ImageDraw.Draw(mask)
    md.text((x, y), text, font=font, fill=255, stroke_width=1, stroke_fill=255)

    for _ in range(1400):
        px = rng.randint(max(0, x), min(W - 1, x + tw))
        py = rng.randint(max(0, y), min(H - 1, y + th))
        if mask.getpixel((px, py)):
            r = rng.choice([1, 1, 1, 2, 2, 3, 4])
            shade = rng.randint(75, 205)
            draw.ellipse((px-r, py-r, px+r, py+r), fill=(shade, shade, shade))

    # Fine cracks/scratches.
    for _ in range(100):
        px = rng.randint(max(0, x), min(W - 1, x + tw))
        py = rng.randint(max(0, y), min(H - 1, y + th))
        if mask.getpixel((px, py)):
            length = rng.randint(5, 35)
            points = [(px, py)]
            for _ in range(rng.randint(2, 4)):
                px += rng.randint(1, max(2, length // 3))
                py += rng.randint(-2, 2)
                points.append((px, py))
            draw.line(points, fill=(105, 105, 105), width=1)

    img.save(f'{name}.jpg', 'JPEG', quality=96, optimize=True)
    print(f'generated {name}.jpg')
