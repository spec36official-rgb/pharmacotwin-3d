"""Pre-process user photo (내사진.jpg) for 3D Avatar Head UV Mapping and Profile Card."""
import os
from PIL import Image, ImageOps, ImageEnhance, ImageFilter

def process_user_photo(
    src_path: str = "내사진.jpg",
    out_dir: str = "static/assets",
) -> dict:
    os.makedirs(out_dir, exist_ok=True)
    if not os.path.exists(src_path):
        raise FileNotFoundError(f"Source photo not found: {src_path}")

    img = Image.open(src_path).convert("RGB")
    w, h = img.size
    # In 내사진.jpg, the image is landscape (e.g., 2560x1920) rotated 90 deg CCW (head pointing left).
    # Rotating 270 deg CCW (= 90 deg clockwise) puts the user upright!
    if w > h:
        img_upright = img.rotate(270, expand=True)
    else:
        img_upright = img

    uw, uh = img_upright.size

    # 1. Create clean square portrait avatar (centered on upper-middle where head & hoodie sit)
    # In upright coordinates (width=uw, height=uh):
    # The user's head in the upright image is roughly x: [0.10*uw, 0.90*uw], y: [0.12*uh, 0.72*uh]
    crop_size = int(min(uw * 0.82, uh * 0.62))
    cx = int(uw * 0.48)
    cy = int(uh * 0.44)
    left = max(0, cx - crop_size // 2)
    top = max(0, cy - crop_size // 2)
    right = min(uw, left + crop_size)
    bottom = min(uh, top + crop_size)

    avatar = img_upright.crop((left, top, right, bottom)).resize((512, 512), Image.Resampling.LANCZOS)
    avatar = ImageEnhance.Contrast(avatar).enhance(1.06)
    avatar_path = os.path.join(out_dir, "user_avatar.jpg")
    avatar.save(avatar_path, quality=92)

    # 2. Create tight face crop for 3D Head Front Decal / Texture
    face_w = int(uw * 0.52)
    face_h = int(uh * 0.40)
    fl = max(0, int(uw * 0.49) - face_w // 2)
    ft = max(0, int(uh * 0.43) - face_h // 2)
    fr = min(uw, fl + face_w)
    fb = min(uh, ft + face_h)
    face_crop = img_upright.crop((fl, ft, fr, fb)).resize((512, 512), Image.Resampling.LANCZOS)
    face_crop_path = os.path.join(out_dir, "user_face_front.jpg")
    face_crop.save(face_crop_path, quality=92)

    # 3. Create 3D Spherical/Cylindrical UV Wrap Texture (1024x512) for Three.js Sphere/Head Geometry
    # In Three.js SphereGeometry, UV (u=0.5, v=0.5) is the front center (+Z or +X depending on rotation).
    # We create a smooth dark-hoodie / skin-blended canvas and feather the face into the center (u=0.5, v=0.5).
    uv_w, uv_h = 1024, 512
    # Base color matching dark navy/charcoal hoodie (#1e2029) so the rest of the head looks like a hoodie/hair cap!
    uv_canvas = Image.new("RGB", (uv_w, uv_h), (34, 36, 46))

    # Resize face to fit the front hemisphere region (width ~ 380px, height ~ 380px)
    face_for_uv = face_crop.resize((380, 380), Image.Resampling.LANCZOS)

    # Create elliptical feather mask for seamless 3D head blending
    mask = Image.new("L", (380, 380), 0)
    from PIL import ImageDraw
    draw = ImageDraw.Draw(mask)
    draw.ellipse((24, 18, 356, 362), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=22))

    paste_x = (uv_w - 380) // 2
    paste_y = (uv_h - 380) // 2
    uv_canvas.paste(face_for_uv, (paste_x, paste_y), mask)

    uv_path = os.path.join(out_dir, "user_face_uv.jpg")
    uv_canvas.save(uv_path, quality=92)

    return {
        "original_size": (w, h),
        "upright_size": (uw, uh),
        "avatar_path": avatar_path,
        "face_front_path": face_crop_path,
        "uv_path": uv_path,
    }

if __name__ == "__main__":
    info = process_user_photo()
    print("Processed photo assets:", info)
