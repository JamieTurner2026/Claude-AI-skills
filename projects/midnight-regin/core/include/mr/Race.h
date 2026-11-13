// Race flow: Waiting -> Countdown (3, 2, 1) -> Racing -> Finished.
// One RaceClock per race; it owns the official race time.
#pragma once

#include "mr/Math.h"

namespace mr
{
enum class RacePhase { Waiting, Countdown, Racing, Finished };

/** What happened during one Update call (for UI beeps and "GO!"). */
struct RaceClockEvents
{
	bool bCountdownTick = false;  // a new countdown number is showing
	int CountdownNumber = 0;      // 3, 2, 1 while counting down
	bool bGo = false;             // the race started during this step
};

inline int CeilToInt(float V)
{
	const int I = static_cast<int>(V);
	return V > static_cast<float>(I) ? I + 1 : I;
}

class RaceClock
{
public:
	explicit RaceClock(float InCountdownSeconds = 3.f) : CountdownSeconds(InCountdownSeconds) {}

	void Reset()
	{
		Phase = RacePhase::Waiting;
		Remaining = 0.f;
		RaceTime = 0.f;
		LastNumber = 0;
	}

	/** Waiting -> Countdown. Ignored in any other phase. */
	void StartCountdown()
	{
		if (Phase != RacePhase::Waiting) return;
		Phase = RacePhase::Countdown;
		Remaining = CountdownSeconds;
		LastNumber = 0;
	}

	RaceClockEvents Update(float DeltaTime)
	{
		RaceClockEvents Ev;
		if (Phase == RacePhase::Countdown)
		{
			Remaining -= DeltaTime;
			if (Remaining <= 0.f)
			{
				Phase = RacePhase::Racing;
				RaceTime = -Remaining;   // keep the part of the step that happened after GO
				Remaining = 0.f;
				Ev.bGo = true;
			}
			else
			{
				const int Number = CeilToInt(Remaining);
				if (Number != LastNumber)
				{
					LastNumber = Number;
					Ev.bCountdownTick = true;
				}
				Ev.CountdownNumber = Number;
			}
		}
		else if (Phase == RacePhase::Racing)
		{
			RaceTime += DeltaTime;
		}
		return Ev;
	}

	/** Racing -> Finished (all racers done, or the race was ended). Freezes the race time. */
	void Finish()
	{
		if (Phase == RacePhase::Racing) Phase = RacePhase::Finished;
	}

	RacePhase GetPhase() const { return Phase; }
	float GetRaceTime() const { return RaceTime; }
	float GetCountdownRemaining() const { return Remaining; }
	/** Cars must not move before GO. */
	bool AreInputsLocked() const { return Phase == RacePhase::Waiting || Phase == RacePhase::Countdown; }

private:
	float CountdownSeconds;
	RacePhase Phase = RacePhase::Waiting;
	float Remaining = 0.f;
	float RaceTime = 0.f;
	int LastNumber = 0;
};
} // namespace mr
