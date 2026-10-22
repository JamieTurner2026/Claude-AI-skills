#!/usr/bin/env python3
"""Run a scene script in headless Blender and write stills / MP4 / model exports.

  render.py SCENE.py --out DIR [--width 1280 --height 720 --samples 32 --engine cycles|eevee]
            [--frames N --fps 24 --mp4] [--export model.glb|.obj|.stl] [--arg key=value ...]

A scene script defines   build(args: dict)                  (create objects/camera/lights)
and optionally           animate(frame, total, args: dict)  (called before each frame, frame 0..total-1)
Works with the `bpy` pip module or a system `blender` binary (re-executes itself inside Blender).
"""
import argparse, os, runpy, shutil, subprocess, sys


def parse(argv):
    p = argparse.ArgumentParser()
    p.add_argument("scene"); p.add_argument("--out", required=True)
    p.add_argument("--width", type=int, default=1280); p.add_argument("--height", type=int, default=720)
    p.add_argument("--samples", type=int, default=32); p.add_argument("--engine", default="cycles", choices=["cycles", "eevee"])
    p.add_argument("--frames", type=int, default=1); p.add_argument("--fps", type=int, default=24)
    p.add_argument("--mp4", action="store_true"); p.add_argument("--export")
    p.add_argument("--arg", action="append", default=[], help="key=value passed to the scene")
    p.add_argument("--max-samples", type=int, default=256, help="safety cap")
    return p.parse_args(argv)


def run(a):
    import bpy
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets"))
    os.makedirs(a.out, exist_ok=True)
    args = dict(kv.split("=", 1) for kv in a.arg)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ns = runpy.run_path(os.path.abspath(a.scene))
    if "build" not in ns: sys.exit("scene script must define build(args)")
    ns["build"](args)
    sc = bpy.context.scene
    if sc.camera is None and not a.export: sys.exit("scene has no camera (use lib.bl_helpers.add_camera_fit)")
    r = sc.render
    r.resolution_x, r.resolution_y, r.resolution_percentage = a.width, a.height, 100
    r.image_settings.file_format = "PNG"
    samples = min(a.samples, a.max_samples)
    if a.engine == "cycles":
        r.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = samples; sc.cycles.use_denoising = True
    else:
        r.engine = "BLENDER_EEVEE"  # needs a working OpenGL context; may fail on headless CPU-only hosts
    outputs = []
    if a.export:
        path = os.path.join(a.out, a.export); ext = os.path.splitext(path)[1].lower()
        if ext in (".glb", ".gltf"): bpy.ops.export_scene.gltf(filepath=path, export_format="GLB" if ext == ".glb" else "GLTF_SEPARATE")
        elif ext == ".obj": bpy.ops.wm.obj_export(filepath=path)
        elif ext == ".stl": bpy.ops.wm.stl_export(filepath=path)
        elif ext == ".blend": bpy.ops.wm.save_as_mainfile(filepath=path)
        else: sys.exit("export must be .glb .gltf .obj .stl or .blend")
        outputs.append(path)
    if sc.camera is not None:
        if a.frames <= 1:
            if "animate" in ns: ns["animate"](0, 1, args)
            path = os.path.join(a.out, "render.png"); r.filepath = path
            bpy.ops.render.render(write_still=True); outputs.append(path)
        else:
            fdir = os.path.join(a.out, "frames"); os.makedirs(fdir, exist_ok=True)
            for i in range(a.frames):
                if "animate" in ns: ns["animate"](i, a.frames, args)
                r.filepath = os.path.join(fdir, f"f_{i:04d}.png")
                bpy.ops.render.render(write_still=True)
            outputs.append(fdir)
            if a.mp4:
                if not shutil.which("ffmpeg"): print("ffmpeg not found; frames left as PNG", file=sys.stderr)
                else:
                    mp4 = os.path.join(a.out, "render.mp4")
                    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(a.fps), "-i", os.path.join(fdir, "f_%04d.png"),
                                    "-c:v", "libx264", "-pix_fmt", "yuv420p", mp4], check=True)
                    outputs.append(mp4)
    for o in outputs: print("OUTPUT", o)


def main():
    try:
        import bpy  # noqa: F401
    except ImportError:
        exe = shutil.which("blender")
        if not exe: sys.exit("Blender not available: run scripts/setup_blender.sh")
        if "--" in sys.argv: sys.exit("unexpected state")
        os.execvp(exe, [exe, "-b", "--python", os.path.abspath(__file__), "--"] + sys.argv[1:])
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    run(parse(argv))


if __name__ == "__main__":
    main()
