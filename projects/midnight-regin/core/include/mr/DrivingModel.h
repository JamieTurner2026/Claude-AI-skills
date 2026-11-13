// Arcade longitudinal model: the Pygame prototype's speed rules in per-second
// form. In Unreal the player car is driven by Chaos Vehicles physics; this
// model is the reference for the prototype's feel and is cheap enough for
// later use by simple AI / ghost cars. Mirrors reign_sim/car.py (non-legacy).
#pragma once

#include "mr/Math.h"

namespace mr
{
struct ArcadeDriveConfig
{
	// Prototype values converted from per-frame (60 FPS) to per-second.
	float MaxSpeed = 600.f;             // 10 px/frame
	float Acceleration = 900.f;         // 0.25 px/frame^2
	float Friction = 180.f;             // 0.05 px/frame^2
	float ReverseSpeedFraction = 0.5f;
	float NitroAcceleration = 1800.f;   // 0.5 px/frame^2
	float NitroSpeedMultiplier = 1.5f;
	float TurnRateDeg = 240.f;          // 4 deg/frame
	float MinTurnSpeed = 12.f;          // 0.2 px/frame
};

struct ArcadeDriveInput
{
	bool bThrottle = false;
	bool bBrake = false;    // also reverse
	bool bBoosting = false; // output of NitrousTank::Update
	float Steer = 0.f;      // -1 right .. +1 left (counter-clockwise positive)
};

struct ArcadeDriveState
{
	float Speed = 0.f;     // negative = reversing
	float AngleDeg = 0.f;
};

inline void StepArcadeDrive(ArcadeDriveState& S, const ArcadeDriveInput& In, const ArcadeDriveConfig& C, float DeltaTime)
{
	const float BoostCap = C.MaxSpeed * C.NitroSpeedMultiplier;
	const float ThrottleCap = In.bBoosting ? BoostCap : C.MaxSpeed;

	if (In.bThrottle)
	{
		if (S.Speed <= ThrottleCap)
			S.Speed = Min(S.Speed + C.Acceleration * DeltaTime, ThrottleCap);
		else // above the cap after a boost: bleed off instead of snapping
			S.Speed = Max(ThrottleCap, S.Speed - C.Friction * DeltaTime);
	}
	else if (In.bBrake)
	{
		S.Speed = Max(S.Speed - C.Acceleration * DeltaTime, -C.MaxSpeed * C.ReverseSpeedFraction);
	}
	else
	{
		S.Speed = MoveTowards(S.Speed, 0.f, C.Friction * DeltaTime);
	}

	if (In.bBoosting && S.Speed > 0.f)
	{
		S.Speed = Min(S.Speed + C.NitroAcceleration * DeltaTime, BoostCap);
	}

	if (Abs(S.Speed) > C.MinTurnSpeed)
	{
		const float Direction = S.Speed > 0.f ? 1.f : -1.f;
		S.AngleDeg += Clamp(In.Steer, -1.f, 1.f) * C.TurnRateDeg * DeltaTime * Direction;
	}
}
} // namespace mr
