#pragma once

#include "CoreMinimal.h"
#include "ChaosVehicleWheel.h"
#include "MRWheels.generated.h"

/** Default front wheel: steers, no drive, no handbrake. Subclass in Blueprint per car. */
UCLASS()
class MIDNIGHTREIGN_API UMRWheelFront : public UChaosVehicleWheel
{
	GENERATED_BODY()

public:
	UMRWheelFront();
};

/** Default rear wheel: driven, handbrake, slightly less grip for controllable slides. */
UCLASS()
class MIDNIGHTREIGN_API UMRWheelRear : public UChaosVehicleWheel
{
	GENERATED_BODY()

public:
	UMRWheelRear();
};
