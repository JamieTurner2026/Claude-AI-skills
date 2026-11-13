// Opponent AI: follow a racing line with look-ahead steering, slow for
// corners, and stay roughly with the player (rubber-banding).
//
// Coordinates are any flat 2D frame (Unreal: X/Y in cm). Steer is positive
// when the target lies towards +Y from the car's forward vector: in Unreal
// that is "steer right" and can be passed to SetSteerInput as is; in a
// right-handed frame it is counter-clockwise.
#pragma once

#include <cmath>

#include "mr/Math.h"

namespace mr
{
struct LinePoint
{
	float X = 0.f, Y = 0.f;
	float Radius = 0.f;   // corner radius at this point; <= 0 means straight
};

/** Fill Radius for every point of a closed line from its neighbours (circumscribed circle). */
inline void ComputeLineRadii(LinePoint* Pts, int Count, float StraightAbove = 100000.f)
{
	for (int i = 0; i < Count; ++i)
	{
		const LinePoint& A = Pts[(i + Count - 1) % Count];
		const LinePoint& B = Pts[i];
		const LinePoint& C = Pts[(i + 1) % Count];
		const float AB = std::sqrt((B.X - A.X) * (B.X - A.X) + (B.Y - A.Y) * (B.Y - A.Y));
		const float BC = std::sqrt((C.X - B.X) * (C.X - B.X) + (C.Y - B.Y) * (C.Y - B.Y));
		const float CA = std::sqrt((A.X - C.X) * (A.X - C.X) + (A.Y - C.Y) * (A.Y - C.Y));
		const float Cross = Abs((B.X - A.X) * (C.Y - A.Y) - (B.Y - A.Y) * (C.X - A.X));
		const float R = Cross > 1e-3f ? (AB * BC * CA) / (2.f * Cross) : 0.f;
		Pts[i].Radius = (R <= 0.f || R > StraightAbove) ? 0.f : R;
	}
}

struct AIDriverConfig
{
	float Skill = 1.0f;               // 0.7 = cautious, 1.0 = strong; scales speed and cornering
	float TopSpeed = 6000.f;          // cm/s
	float MaxLateralAccel = 1000.f;   // cm/s^2 the AI plans corners with
	float BrakeDecel = 1300.f;        // cm/s^2 the AI assumes it can brake at
	float LookAheadBase = 700.f;      // cm
	float LookAheadPerSpeed = 0.35f;  // seconds of travel added to the look-ahead
	float Wheelbase = 262.f;          // cm, of the car being driven
	float MaxSteerAngleDeg = 40.f;    // front wheel lock of the car being driven
	float SteerGain = 1.0f;           // > 1 turns in harder (compensates understeer)
	float CornerScanDistance = 15000.f;
	float RubberBandMax = 0.10f;      // at most +/-10 % target speed
	float RubberBandDistance = 6000.f; // gap at which the full adjustment applies
};

struct AIDriverInput
{
	float X = 0.f, Y = 0.f;
	float ForwardX = 1.f, ForwardY = 0.f;   // unit vector
	float Speed = 0.f;
	float GapToPlayer = 0.f;   // > 0: the player is this far ahead (speed up); < 0: behind (ease off); 0: off
};

struct AIDriverOutput
{
	float Throttle = 0.f;   // 0..1
	float Brake = 0.f;      // 0..1
	float Steer = 0.f;      // -1..1 fraction of full lock, see header comment for the sign
	float Curvature = 0.f;  // 1/cm, signed like Steer: the arc that reaches the look-ahead point
	float TargetSpeed = 0.f;
	int NearestIndex = 0;
};

class AIDriver
{
public:
	void Reset() { LastIndex = -1; }

	AIDriverOutput Update(const AIDriverInput& In, const LinePoint* Pts, int Count, const AIDriverConfig& C)
	{
		AIDriverOutput Out;
		if (!Pts || Count < 3) return Out;

		// Nearest line point: full search the first time, then a window around the last one.
		int Begin = 0, Span = Count;
		if (LastIndex >= 0)
		{
			Begin = LastIndex - 2;
			Span = Count < 16 ? Count : 16;
		}
		float BestD2 = -1.f;
		int Nearest = 0;
		for (int k = 0; k < Span; ++k)
		{
			const int i = ((Begin + k) % Count + Count) % Count;
			const float DX = Pts[i].X - In.X, DY = Pts[i].Y - In.Y;
			const float D2 = DX * DX + DY * DY;
			if (BestD2 < 0.f || D2 < BestD2) { BestD2 = D2; Nearest = i; }
		}
		LastIndex = Nearest;
		Out.NearestIndex = Nearest;

		const float Skill = Clamp(C.Skill, 0.3f, 1.5f);

		// Walk forward along the line: find the look-ahead target and the speed the corners allow.
		const float LookAhead = C.LookAheadBase + C.LookAheadPerSpeed * Abs(In.Speed);
		float TargetX = Pts[Nearest].X, TargetY = Pts[Nearest].Y;
		bool bHaveTarget = false;

		float Band = 0.f;
		if (C.RubberBandDistance > 0.f)
			Band = Clamp(In.GapToPlayer / C.RubberBandDistance, -1.f, 1.f) * C.RubberBandMax;
		float Target = C.TopSpeed * Skill * (1.f + Band);

		float Dist = 0.f;
		int i = Nearest;
		for (int Step = 0; Step < Count && Dist < Max(C.CornerScanDistance, LookAhead); ++Step)
		{
			const int j = (i + 1) % Count;
			const float SX = Pts[j].X - Pts[i].X, SY = Pts[j].Y - Pts[i].Y;
			const float Len = std::sqrt(SX * SX + SY * SY);
			if (!bHaveTarget && Dist + Len >= LookAhead && Len > 0.f)
			{
				const float T = (LookAhead - Dist) / Len;
				TargetX = Pts[i].X + SX * T;
				TargetY = Pts[i].Y + SY * T;
				bHaveTarget = true;
			}
			Dist += Len;
			if (Pts[j].Radius > 0.f)
			{
				const float Corner2 = C.MaxLateralAccel * Skill * (1.f + Band) * Pts[j].Radius;
				const float Allowed = std::sqrt(Corner2 + 2.f * C.BrakeDecel * Dist);
				Target = Min(Target, Allowed);
			}
			i = j;
		}
		if (!bHaveTarget) { TargetX = Pts[i].X; TargetY = Pts[i].Y; }
		Out.TargetSpeed = Target;

		// Pure pursuit: the arc through the car and the look-ahead point, turned into a
		// front-wheel angle for this car's wheelbase. Tracks a constant-radius corner exactly.
		const float TX = TargetX - In.X, TY = TargetY - In.Y;
		const float Cross = In.ForwardX * TY - In.ForwardY * TX;
		const float Dist2 = TX * TX + TY * TY;
		Out.Curvature = Dist2 > 1.f ? 2.f * Cross / Dist2 : 0.f;
		const float MaxSteerRad = C.MaxSteerAngleDeg * 3.14159265f / 180.f;
		const float WheelAngle = std::atan(C.Wheelbase * Out.Curvature * C.SteerGain);
		Out.Steer = MaxSteerRad > 0.f ? Clamp(WheelAngle / MaxSteerRad, -1.f, 1.f) : 0.f;

		// Pedals from the speed error.
		const float Error = Target - In.Speed;
		if (Error > 0.f)
			Out.Throttle = Clamp(0.25f + Error / 400.f, 0.f, 1.f);
		else if (Error < -30.f)
			Out.Brake = Clamp(-Error / 150.f, 0.f, 1.f);   // firm: braking late and softly runs wide
		return Out;
	}

private:
	int LastIndex = -1;
};
} // namespace mr
