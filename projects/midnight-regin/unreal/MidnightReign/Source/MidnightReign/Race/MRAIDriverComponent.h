#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "mr/AIDriver.h"
#include "MRAIDriverComponent.generated.h"

class AMRRaceManager;
class AMRVehiclePawn;

/**
 * Drives an AMRVehiclePawn around the racing line with mr::AIDriver. It only calls the same
 * input functions a player (or touch controls) would, so AI cars obey the same physics.
 * Added at runtime by AMRRaceManager; can also be put on a Blueprint car by hand.
 */
UCLASS(ClassGroup = (MidnightReign), meta = (BlueprintSpawnableComponent))
class MIDNIGHTREIGN_API UMRAIDriverComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UMRAIDriverComponent();
	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

	UPROPERTY(BlueprintReadWrite, Category = "MidnightReign|AI") TObjectPtr<AMRRaceManager> Manager;
	UPROPERTY(BlueprintReadWrite, Category = "MidnightReign|AI") int32 RacerId = 0;

	/** 0.7 cautious .. 1.0 strong. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "MidnightReign|AI") float Skill = 0.9f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "MidnightReign|AI") float TopSpeedKmh = 200.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "MidnightReign|AI") float WheelbaseCm = 262.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "MidnightReign|AI") float MaxSteerAngleDeg = 40.f;

private:
	mr::AIDriver Driver;
};
