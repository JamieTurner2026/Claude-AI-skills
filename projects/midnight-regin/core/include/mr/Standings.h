// Race positions and the final results table.
// Order: finished racers by finish time, then everyone else by how far round
// they are (valid checkpoints passed, then distance to their next checkpoint).
#pragma once

#include "mr/Math.h"

namespace mr
{
constexpr int MaxRacers = 16;

struct RacerStanding
{
	int RacerId = 0;
	int CheckpointsPassed = 0;
	int LapsCompleted = 0;
	float DistanceToNext = 0.f;   // to the racer's next checkpoint; smaller is further ahead
	bool bFinished = false;
	float FinishTime = 0.f;       // official race time at the finish
	float BestLap = -1.f;
};

inline bool RanksAhead(const RacerStanding& A, const RacerStanding& B)
{
	if (A.bFinished != B.bFinished) return A.bFinished;
	if (A.bFinished) return A.FinishTime < B.FinishTime;
	if (A.CheckpointsPassed != B.CheckpointsPassed) return A.CheckpointsPassed > B.CheckpointsPassed;
	return A.DistanceToNext < B.DistanceToNext;
}

/** Sort in place, leader first. Stable, so exact ties keep their previous order. */
inline void SortStandings(RacerStanding* S, int Count)
{
	for (int i = 1; i < Count; ++i)
	{
		const RacerStanding Key = S[i];
		int j = i - 1;
		while (j >= 0 && RanksAhead(Key, S[j]))
		{
			S[j + 1] = S[j];
			--j;
		}
		S[j + 1] = Key;
	}
}

/** 1-based position of a racer in sorted standings, 0 if not found. */
inline int PositionOf(const RacerStanding* Sorted, int Count, int RacerId)
{
	for (int i = 0; i < Count; ++i)
		if (Sorted[i].RacerId == RacerId) return i + 1;
	return 0;
}

struct ResultRow
{
	int Position = 0;
	int RacerId = 0;
	bool bFinished = false;
	float TotalTime = 0.f;      // valid when bFinished
	float GapToWinner = 0.f;    // seconds behind the winner, valid when both finished
	int LapsBehind = 0;         // for racers who did not finish
	float BestLap = -1.f;
};

/** Build the results table from sorted standings. Returns the number of rows written. */
inline int BuildResults(const RacerStanding* Sorted, int Count, ResultRow* Out)
{
	for (int i = 0; i < Count; ++i)
	{
		ResultRow& Row = Out[i];
		Row = ResultRow();
		Row.Position = i + 1;
		Row.RacerId = Sorted[i].RacerId;
		Row.bFinished = Sorted[i].bFinished;
		Row.BestLap = Sorted[i].BestLap;
		if (Row.bFinished)
		{
			Row.TotalTime = Sorted[i].FinishTime;
			Row.GapToWinner = Sorted[0].bFinished ? Sorted[i].FinishTime - Sorted[0].FinishTime : 0.f;
		}
		else
		{
			Row.LapsBehind = Sorted[0].LapsCompleted - Sorted[i].LapsCompleted;
		}
	}
	return Count;
}
} // namespace mr
