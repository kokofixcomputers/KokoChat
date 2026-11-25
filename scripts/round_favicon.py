from PIL import Image, ImageDraw
import sys

IN = 'public/favicon.png'
OUT = 'public/favicon.png'

im = Image.open(IN).convert('RGBA')
size = im.size
mask = Image.new('L', size, 0)
Draw = ImageDraw.Draw(mask)
# draw a centered ellipse to make the favicon round
Draw.ellipse([(0,0),(size[0],size[1])], fill=255)

# apply mask to alpha channel
r, g, b, a = im.split()
new_alpha = Image.composite(a, mask, mask)
im.putalpha(new_alpha)

im.save(OUT, format='PNG')
print('Rounded favicon saved to', OUT)