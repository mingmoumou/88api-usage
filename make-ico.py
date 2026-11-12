# 从 widget/icon.png 生成 Windows 能正常显示的多尺寸 ICO。
# 关键点：16~128 帧必须用 DIB(BMP) 编码，只有 256 帧才用 PNG ——
# 全部用 PNG 时资源管理器会把它显示成空白文件图标。
import io
import struct
import sys

from PIL import Image

SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def dib_bytes(img):
    w, h = img.size
    px = img.load()
    rows = bytearray()
    for y in range(h - 1, -1, -1):          # DIB 自下而上
        for x in range(w):
            r, g, b, a = px[x, y]
            rows += bytes((b, g, r, a))     # BGRA
    xor = bytes(rows)
    mask_stride = ((w + 31) // 32) * 4
    and_mask = bytes(mask_stride * h)        # 全 0：交给 alpha 通道决定透明度
    bih = struct.pack('<IiiHHIIiiII', 40, w, h * 2, 1, 32,
                      0, len(xor) + len(and_mask), 0, 0, 0, 0)
    return bih + xor + and_mask


def build(src_path, out_path):
    src = Image.open(src_path).convert('RGBA')
    frames = []
    for size in SIZES:
        im = src.resize(size, Image.LANCZOS)
        if size[0] >= 256:
            buf = io.BytesIO()
            im.save(buf, 'PNG')
            frames.append((size, buf.getvalue()))
        else:
            frames.append((size, dib_bytes(im)))

    header = struct.pack('<HHH', 0, 1, len(frames))
    offset = 6 + 16 * len(frames)
    entries, blob = bytearray(), bytearray()
    for (w, h), data in frames:
        entries += struct.pack('<BBBBHHII', w if w < 256 else 0, h if h < 256 else 0,
                               0, 0, 1, 32, len(data), offset)
        offset += len(data)
        blob += data
    open(out_path, 'wb').write(header + bytes(entries) + bytes(blob))

    print('wrote %s (%d frames, %d bytes)' % (out_path, len(frames), offset))


if __name__ == '__main__':
    build(sys.argv[1] if len(sys.argv) > 1 else 'widget/icon.png',
          sys.argv[2] if len(sys.argv) > 2 else 'widget/icon.ico')
