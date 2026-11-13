#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "mr/Nitrous.h"
#include "MRNitrousComponent.generated.h"

/** Data-driven nitrous settings. Upgrades replace these values (see ApplySettings). */
USTRUCT(BlueprintType)
struct MIDNIGHTREIGN_API FMRNitrousSettings
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nitrous", meta = (ClampMin = "1"))
	float Capacity = 100.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nitrous", meta = (ClampMin = "0"))
	float DrainPerSecond = 25.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nitrous", meta = (ClampMin = "0"))
	float RechargePerSecond = 8.f;

	/** Seconds after releasing the input before the tank starts refilling. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nitrous", meta = (ClampMin = "0"))
	float RechargeDelay = 1.5f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nitrous", meta = (ClampMin = "0"))
	float MinToActivate = 10.f;

	/** Extra forward acceleration while boosting, cm/s^2 (mass independent). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nitrous", meta = (ClampMin = "0"))
	float BoostAcceleration = 900.f;

	/** No extra push above this speed. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nitrous", meta = (ClampMin = "0"))
	float MaxBoostSpeedKmh = 320.f;

	mr::NitrousConfig ToCoreConfig() const;
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE(FMRNitrousEvent);

/**
 * Nitrous boost for any physics-simulating actor.
 * Tank logic lives in the engine-independent mr::NitrousTank (unit tested);
 * this component feeds it, applies the push and raises events for VFX/SFX
 * (exhaust flames, camera effects) so presentation stays out of gameplay code.
 */
UCLASS(ClassGroup = (MidnightReign), meta = (BlueprintSpawnableComponent))
class MIDNIGHTREIGN_API UMRNitrousComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UMRNitrousComponent();

	virtual void BeginPlay() override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

	/** Hold/release the nitrous input. */
	UFUNCTION(BlueprintCallable, Category = "Nitrous")
	void SetBoostRequested(bool bRequested);

	/** Replace settings (e.g. after installing an upgrade). Keeps the current fill fraction. */
	UFUNCTION(BlueprintCallable, Category = "Nitrous")
	void ApplySettings(const FMRNitrousSettings& NewSettings);

	UFUNCTION(BlueprintCallable, Category = "Nitrous")
	void Refill();

	UFUNCTION(BlueprintPure, Category = "Nitrous")
	bool IsBoosting() const { return bBoosting; }

	/** 0..1 for HUD bars. */
	UFUNCTION(BlueprintPure, Category = "Nitrous")
	float GetNitrousFraction() const { return Tank.GetFraction(); }

	UFUNCTION(BlueprintPure, Category = "Nitrous")
	float GetNitrousAmount() const { return Tank.GetAmount(); }

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Nitrous")
	FMRNitrousSettings Settings;

	/** Boost needs at least this forward speed (cm/s); matches the prototype's "only when moving forward". */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Nitrous")
	float MinForwardSpeedToBoost = 50.f;

	UPROPERTY(BlueprintAssignable, Category = "Nitrous")
	FMRNitrousEvent OnBoostStarted;

	UPROPERTY(BlueprintAssignable, Category = "Nitrous")
	FMRNitrousEvent OnBoostStopped;

	UPROPERTY(BlueprintAssignable, Category = "Nitrous")
	FMRNitrousEvent OnDepleted;

private:
	mr::NitrousTank Tank;
	bool bBoostRequested = false;
	bool bBoosting = false;
};
