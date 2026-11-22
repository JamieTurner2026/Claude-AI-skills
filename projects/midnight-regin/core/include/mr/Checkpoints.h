// Checkpoint and lap progress for one racer.
// Checkpoint 0 is the start/finish line. Cars start behind it, so the first
// crossing only starts lap 1; every later crossing completes a lap.
// Checkpoints must be taken in order: a skipped or repeated one is rejected.
#pragma once

#include "mr/Math.h"

namespace mr
{
constexpr int MaxCheckpoints = 64;

enum class CheckpointResult { Ignored, WrongCheckpoint, Advanced, LapCompleted, RaceFinished };

struct RacerProgress
{
	int NextCheckpoint = 0;
	int LapsCompleted = 0;
	int CheckpointsPassed = 0;   // total valid checkpoints, used for race positions
	bool bCrossedStart = false;
	bool bFinished = false;
};

inline CheckpointResult PassCheckpoint(RacerProgress& P, int Index, int CheckpointCount, int TotalLaps)
{
	if (P.bFinished || CheckpointCount <= 0 || Index < 0 || Index >= CheckpointCount) return CheckpointResult::Ignored;
	if (Index != P.NextCheckpoint) return CheckpointResult::WrongCheckpoint;

	P.NextCheckpoint = (Index + 1) % CheckpointCount;
	++P.CheckpointsPassed;
	if (Index != 0) return CheckpointResult::Advanced;

	if (!P.bCrossedStart)
	{
		P.bCrossedStart = true;
		return CheckpointResult::Advanced;
	}
	++P.LapsCompleted;
	if (P.LapsCompleted >= TotalLaps)
	{
		P.bFinished = true;
		return CheckpointResult::RaceFinished;
	}
	return CheckpointResult::LapCompleted;
}

/** Lap number to show on the HUD (1-based, never above TotalLaps). */
inline int DisplayLap(const RacerProgress& P, int TotalLaps)
{
	const int Lap = P.LapsCompleted + 1;
	return Lap > TotalLaps ? TotalLaps : Lap;
}

/** A checkpoint line: centre, direction of travel (unit vector) and half width. */
struct Gate
{
	float X = 0.f, Y = 0.f;
	float DirX = 1.f, DirY = 0.f;
	float HalfWidth = 1000.f;
};

/**
 * Did the move Prev -> Cur cross the gate? +1 = in the direction of travel,
 * -1 = backwards, 0 = no crossing. Works at any speed (no tunnelling through
 * a thin trigger), so it can replace or back up overlap volumes.
 */
inline int GateCrossing(const Gate& G, float PrevX, float PrevY, float CurX, float CurY)
{
	const float A0 = (PrevX - G.X) * G.DirX + (PrevY - G.Y) * G.DirY;
	const float A1 = (CurX - G.X) * G.DirX + (CurY - G.Y) * G.DirY;
	const bool bForward = A0 < 0.f && A1 >= 0.f;
	const bool bBackward = A0 >= 0.f && A1 < 0.f;
	if (!bForward && !bBackward) return 0;

	const float T = A0 / (A0 - A1);
	const float HitX = Lerp(PrevX, CurX, T) - G.X;
	const float HitY = Lerp(PrevY, CurY, T) - G.Y;
	const float Lateral = HitX * (-G.DirY) + HitY * G.DirX;
	if (Abs(Lateral) > G.HalfWidth) return 0;
	return bForward ? 1 : -1;
}

struct WrongWayConfig
{
	float FacingDotThreshold = -0.3f;  // forward . track direction below this counts as facing backwards
	float MinSpeed = 300.f;            // ignore when nearly stopped (e.g. after a spin)
	float Delay = 1.5f;                // seconds before the warning shows
};

/** Shows a "wrong way" warning after the racer has driven against the track direction for a moment. */
class WrongWayDetector
{
public:
	/** @param FacingDot  dot(car forward, track direction), both unit vectors */
	bool Update(float FacingDot, float Speed, float DeltaTime, const WrongWayConfig& C = WrongWayConfig())
	{
		if (FacingDot < C.FacingDotThreshold && Speed > C.MinSpeed)
			Timer = Min(Timer + DeltaTime, C.Delay);
		else
			Timer = 0.f;
		return Timer >= C.Delay;
	}

private:
	float Timer = 0.f;
};
} // namespace mr
