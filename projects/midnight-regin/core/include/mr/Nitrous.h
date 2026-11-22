// Limited nitrous tank: capacity, drain, delayed recharge.
// Mirrors prototype/python/reign_sim/nitrous.py.
#pragma once

#include "mr/Math.h"

namespace mr
{
struct NitrousConfig
{
	float Capacity = 100.f;
	float DrainPerSec = 25.f;      // 4 s of boost from a full tank
	float RechargePerSec = 8.f;
	float RechargeDelay = 1.5f;    // seconds after release before refill starts
	float MinToActivate = 10.f;    // cannot re-trigger on fumes
};

/** What changed during one Update call (for sound / exhaust-flame events). */
struct NitrousEvents
{
	bool bBoosting = false;     // boost was delivered during this step
	bool bActivated = false;    // went from off to on
	bool bDeactivated = false;  // went from on to off (released or depleted)
	bool bDepleted = false;     // tank hit zero this step
};

class NitrousTank
{
public:
	NitrousTank() { Reset(); }
	explicit NitrousTank(const NitrousConfig& InConfig) : Config(InConfig) { Reset(); }

	/** Change config (e.g. after an upgrade). Keeps the current fill fraction. */
	void SetConfig(const NitrousConfig& InConfig)
	{
		const float Fraction = GetFraction();
		Config = InConfig;
		Amount = Config.Capacity * Fraction;
	}

	void Reset()
	{
		Amount = Config.Capacity;
		bActive = false;
		TimeSinceUse = Config.RechargeDelay;
	}

	/**
	 * Advance by DeltaTime seconds.
	 * @param bWantBoost  player is holding the nitrous input
	 * @param bCanBoost   vehicle state allows boost (e.g. moving forward)
	 */
	NitrousEvents Update(bool bWantBoost, bool bCanBoost, float DeltaTime)
	{
		NitrousEvents Ev;
		const bool bWasActive = bActive;
		const bool bWants = bWantBoost && bCanBoost;

		if (bWants && !bActive)
		{
			bActive = Amount >= Config.MinToActivate && Amount > 0.f;
		}
		else if (!bWants)
		{
			bActive = false;
		}

		if (bActive)
		{
			Ev.bBoosting = true;
			Amount = Max(0.f, Amount - Config.DrainPerSec * DeltaTime);
			TimeSinceUse = 0.f;
			if (Amount <= 0.f)
			{
				bActive = false;
				Ev.bDepleted = true;
			}
		}
		else if (!bWantBoost)
		{
			// Refill only once the input is released, so holding it on an
			// empty tank does not make the boost stutter on and off.
			TimeSinceUse += DeltaTime;
			if (TimeSinceUse >= Config.RechargeDelay)
			{
				Amount = Min(Config.Capacity, Amount + Config.RechargePerSec * DeltaTime);
			}
		}

		Ev.bActivated = !bWasActive && Ev.bBoosting;
		Ev.bDeactivated = (bWasActive || Ev.bBoosting) && !bActive;
		return Ev;
	}

	float GetAmount() const { return Amount; }
	float GetFraction() const { return Config.Capacity > 0.f ? Amount / Config.Capacity : 0.f; }
	bool IsActive() const { return bActive; }
	const NitrousConfig& GetConfig() const { return Config; }
	void SetAmount(float InAmount) { Amount = Clamp(InAmount, 0.f, Config.Capacity); }

private:
	NitrousConfig Config;
	float Amount = 0.f;
	bool bActive = false;
	float TimeSinceUse = 0.f;
};
} // namespace mr
