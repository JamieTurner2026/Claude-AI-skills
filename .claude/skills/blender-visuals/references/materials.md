# Materials and texturing

Source: MCP for Blender guide `materials` (MIT), adapted. `bl_helpers.material(name, color, metallic, roughness, emission)` already does the basics version-safely.

## By hand
```python
mat = bpy.data.materials.new("Brushed Steel"); mat.use_nodes = True  # no-op in 5.0+
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = (0.6, 0.6, 0.62, 1)
bsdf.inputs["Metallic"].default_value = 1.0; bsdf.inputs["Roughness"].default_value = 0.35
obj.data.materials.clear(); obj.data.materials.append(mat)
```
Renamed sockets: `inputs.get("Emission Color") or inputs.get("Emission")`.

## Believable values
| Material | Base colour (linear) | Metallic | Roughness |
|---|---|---|---|
| Painted wall / machine guard | 0.5-0.7 grey (or paint colour) | 0 | 0.8-0.9 |
| Varnished wood | textured | 0 | 0.3-0.5 |
| Plastic (housings, buttons) | any | 0 | 0.3-0.6 |
| Polished metal | 0.9 | 1 | 0.05-0.2 |
| Brushed steel / aluminium | 0.6-0.8 | 1 | 0.3-0.4 |
| Rubber (belts, tyres, cables) | 0.02-0.05 | 0 | 0.8 |
| Glass | white | 0 | 0; Transmission 1, IOR 1.45 |
| Indicator / status light | colour | 0 | 0.5; `emission=2-5` |

Nothing is pure black (0) or pure white (1) as a base colour; stay between ~0.02 and 0.9. Hex colours in `bl_helpers` are sRGB-ish; `#050505` is about rubber, `#e6e6e6` about the brightest base.

## Textures
- Full PBR sets (Poly Haven, downloaded): Image Texture nodes into Base Color, Roughness, Normal (via Normal Map node).
- Roughness, metallic and normal images must be Non-Color: `img.colorspace_settings.name = "Non-Color"`.
- Tiling: Mapping node Scale = surface size (m) / texture size (m). Prefer large textures for floors and walls.
- Objects need UVs. Primitives have them; scripted meshes need box projection (`Texture Coordinate > Object` into Mapping, Image Texture projection `BOX`).

## Procedural
Noise, Voronoi and Wave textures through a Color Ramp give variation without images: grunge in roughness, stains, wood rings. A little noise in roughness makes any flat material look less CG. Look up a node's sockets before indexing them (`bpy.md`).

## Check it
Only a render shows real materials: preview render and Read the PNG.
