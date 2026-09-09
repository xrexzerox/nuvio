from PIL import Image, ImageDraw, ImageFont, ImageFilter
import random

W, H = 1024, 576
CATEGORIES = ['netflix', 'hbo', 'prime', 'appletv', 'anime', 'horror', 'drama', 'korean', 'kids']
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

random.seed(20260909)

for name in CATEGORIES:
    image = Image.new('RGB', (W, H), (0, 0, 0))
    draw = ImageDraw.Draw(image)
    text = name.upper()

    size = 150
    font = ImageFont.truetype(FONT, size)
    # Fit long labels while preserving the same bold centered look.
    while draw.textbbox((0, 0), text, font=font)[2] > W - 120:
        size -= 2
        font = ImageFont.truetype(FONT, size)

    bbox = draw.textbbox((0, 0), text, font=font, stroke_width=1)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (W - tw) // 2 - bbox[0]
    y = (H - th) // 2 - bbox[1]

    # Slightly off-white stone texture, matching the reference aesthetic.
    mask = Image.new('L', (W, H), 0)
    md = ImageDraw.Draw(mask)
    md.text((x, y), text, font=font, fill=255, stroke_width=1, stroke_fill=255)

    texture = Image.new('L', (W, H), 235)
    td = ImageDraw.Draw(texture)
    for _ in range(900):
        px = random.randrange(max(1, x), min(W - 1, x + tw))
        py = random.randrange(max(1, y), min(H - 1, y + th))
        r = random.choice([1, 1, 2, 2, 3, 5])
        shade = random.randrange(80, 235)
        td.ellipse((px-r, py-r, px+r, py+r), fill=shade)

    texture = texture.filter(ImageFilter.GaussianBlur(0.35))
    image.paste((235, 235, 235), mask=mask)
    image.paste((texture.point(lambda p: max(0, min(255, p))),) * 3, mask=mask)

    # Repaint the lettering lightly so it stays crisp while retaining texture.
    draw = ImageDraw.Draw(image)
    draw.text((x, y), text, font=font, fill=(232, 232, 232))
    for _ in range(350):
        px = random.randint(x, x + tw)
        py = random.randint(y, y + th)
        if mask.getpixel((min(W-1, px), min(H-1, py))) > 0:
            r = random.choice([1, 1, 2, 3])
            shade = random.randint(100, 205)
            draw.rectangle((px, py, px+r, py+r), fill=(shade, shade, shade))

    # Very subtle scratches.
    for _ in range(45):
        px = random.randint(x, x + tw)
        py = random.randint(y, y + th)
        if mask.getpixel((min(W-1, px), min(H-1, py))) > 0:
            length = random.randint(5, 28)
            draw.line((px, py, px + length, py + random.choice([-1, 0, 1])), fill=(125, 125, 125), width=1)

    image.save(f'{name}.jpg', 'JPEG', quality=95, optimize=True)
    print(f'generated {name}.jpg')
