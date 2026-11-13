// Lap and sector timing for one racer, driven by the official race time.
// Lap 1 is timed from GO; later laps from the previous line crossing.
#pragma once

#include "mr/Checkpoints.h"

namespace mr
{
class LapTimer
{
public:
	float GetCurrentLapTime(float RaceTime) const { return RaceTime - LapStartTime; }
	float GetLastLap() const { return LastLap; }        // < 0 until a lap is completed
	float GetBestLap() const { return BestLap; }        // < 0 until a lap is completed
	int GetLapsTimed() const { return LapsTimed; }

	/**
	 * Record a sector split at checkpoint Index (1..N-1; checkpoint 0 is handled by OnLapCompleted).
	 * Returns true and sets OutDeltaToBest (negative = faster) when a best lap exists to compare with.
	 */
	bool OnCheckpoint(int Index, float RaceTime, float& OutDeltaToBest)
	{
		if (Index <= 0 || Index >= MaxCheckpoints) return false;
		CurrentSplits[Index] = RaceTime - LapStartTime;
		bCurrentValid[Index] = true;
		if (BestLap < 0.f || !bBestValid[Index]) return false;
		OutDeltaToBest = CurrentSplits[Index] - BestSplits[Index];
		return true;
	}

	/** Call when the start/finish line completes a lap. Returns the lap time. */
	float OnLapCompleted(float RaceTime)
	{
		LastLap = RaceTime - LapStartTime;
		++LapsTimed;
		if (BestLap < 0.f || LastLap < BestLap)
		{
			BestLap = LastLap;
			for (int i = 0; i < MaxCheckpoints; ++i)
			{
				BestSplits[i] = CurrentSplits[i];
				bBestValid[i] = bCurrentValid[i];
			}
		}
		for (int i = 0; i < MaxCheckpoints; ++i) bCurrentValid[i] = false;
		LapStartTime = RaceTime;
		return LastLap;
	}

private:
	float LapStartTime = 0.f;
	float LastLap = -1.f;
	float BestLap = -1.f;
	int LapsTimed = 0;
	float CurrentSplits[MaxCheckpoints] = {};
	float BestSplits[MaxCheckpoints] = {};
	bool bCurrentValid[MaxCheckpoints] = {};
	bool bBestValid[MaxCheckpoints] = {};
};
} // namespace mr
