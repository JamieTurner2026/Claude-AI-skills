# Scene design

Source: MCP for Blender guide `scene` (MIT), adapted for headless renders.

## Workflow
1. Block out with primitives at real-world size: layout, big shapes, camera. Preview render (640x360, 8 samples) and Read it to check proportions.
2. Replace blockout pieces with real models (`import_model`), biggest and most visible first.
3. Light, then materials, then small props.
4. Judge the image, not your intentions: anything floating, clipping, wrong size, or hidden from camera?

## Models
- Script simple or procedural geometry (walls, floors, shelves, stairs, arrays). Import specific things as glTF/OBJ/STL from a trusted source.
- Free sources Jay can download on the PC: Poly Haven (CC0 HDRIs, textures, models; no credit needed). Poly Pizza CC-BY models need a credit line. Don't mix low-poly and photoreal styles in one frame.

## After every import
Imports arrive at arbitrary scale, rotation and origin. Use `bounds([obj])`:
- Scale to real size from the bounds, not by eye.
- Put it on the ground: `obj.location.z -= min_z`.
- Rotate to face the camera; models usually face -Y or +Y. Check with a front preview.
- Check it doesn't intersect neighbours.

## Composition
- Decide the camera early. Focal length 35-50 mm natural, 85 mm+ product shots, 24 mm or wider interiors (`cam.data.lens`). `add_camera_fit` uses a field of view; set `lens` after it if needed and re-check framing.
- Foreground, midground, background; negative space; subject on a third.
- Vary scale and rotation of repeated props slightly; perfect grids read fake.
- Ground contact sells realism: props sit on surfaces.

## Lighting
- An HDRI (Poly Haven, on disk) for ambient light and reflections, strength 0.5-1.5, plus a key light (sun or area) for shape. Without one, `add_lights()` gives a key/fill/rim setup.
- Products: three-point (key, weaker fill, rim behind). Interiors: area lights in windows plus emissive practicals.
- Blown-out white or pure black areas: fix light power before exposure.

## Render
Preview at low samples; raise samples only for the final (render.py caps at 256). CPU Cycles is the safe default headless.
