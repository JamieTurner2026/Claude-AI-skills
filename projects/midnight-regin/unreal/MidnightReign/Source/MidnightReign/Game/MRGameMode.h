#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "MRGameMode.generated.h"

/**
 * Free-roam driving game mode for Milestone 1: spawns the player car and the
 * driving HUD. Make a Blueprint subclass to swap in your vehicle Blueprint.
 */
UCLASS()
class MIDNIGHTREIGN_API AMRGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	AMRGameMode();
};
