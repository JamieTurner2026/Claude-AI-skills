// MIDNIGHT REIGN core: engine-independent gameplay maths.
// Header-only C++17, no Unreal and no heavy STL, so the same code is unit
// tested with plain clang/cmake and included by the Unreal module.
#pragma once

namespace mr
{
inline float Clamp(float V, float Lo, float Hi) { return V < Lo ? Lo : (V > Hi ? Hi : V); }
inline float Min(float A, float B) { return A < B ? A : B; }
inline float Max(float A, float B) { return A > B ? A : B; }
inline float Abs(float V) { return V < 0.f ? -V : V; }
inline float Lerp(float A, float B, float T) { return A + (B - A) * T; }
inline float SmoothStep01(float T)
{
	T = Clamp(T, 0.f, 1.f);
	return T * T * (3.f - 2.f * T);
}
/** Move Current towards Target by at most MaxDelta. */
inline float MoveTowards(float Current, float Target, float MaxDelta)
{
	const float D = Target - Current;
	if (Abs(D) <= MaxDelta) return Target;
	return Current + (D > 0.f ? MaxDelta : -MaxDelta);
}
} // namespace mr
