// Speed-dependent steering and input smoothing.
// The prototype turned 4 degrees per frame at any speed; a 3D car needs less
// steering lock as speed rises or it becomes undriveable.
#pragma once

#include "mr/Math.h"

namespace mr
{
struct SteeringConfig
{
	float FullLockBelowKmh = 40.f;   // full steering authority up to here
	float MinLockAboveKmh = 220.f;   // reduced authority from here on
	float MinLockScale = 0.25f;      // fraction of full lock at high speed
	float RiseRate = 4.0f;           // input units per second towards the target
	float ReturnRate = 6.0f;         // input units per second back to centre
};

/** Multiplier (MinLockScale..1) for the steering input at a given speed. */
inline float SteeringScaleForSpeed(float SpeedKmh, const SteeringConfig& C)
{
	const float Range = C.MinLockAboveKmh - C.FullLockBelowKmh;
	if (Range <= 0.f) return 1.f;
	const float T = SmoothStep01((Abs(SpeedKmh) - C.FullLockBelowKmh) / Range);
	return Lerp(1.f, Clamp(C.MinLockScale, 0.f, 1.f), T);
}

/**
 * Smooth a digital (keyboard) steering input so the wheels do not snap.
 * Moving away from centre uses RiseRate; returning or reversing direction
 * uses the faster ReturnRate.
 */
inline float SmoothSteeringInput(float Current, float Target, const SteeringConfig& C, float DeltaTime)
{
	Target = Clamp(Target, -1.f, 1.f);
	const bool bTowardsCentre = Abs(Target) < Abs(Current) || (Target * Current < 0.f);
	const float Rate = bTowardsCentre ? C.ReturnRate : C.RiseRate;
	return MoveTowards(Current, Target, Rate * DeltaTime);
}
} // namespace mr
