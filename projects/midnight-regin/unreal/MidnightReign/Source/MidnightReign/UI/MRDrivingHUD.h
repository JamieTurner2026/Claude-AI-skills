#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "MRDrivingHUD.generated.h"

/**
 * Minimal neon driving HUD drawn on the canvas: speed, gear, nitrous bar and
 * a controls hint (the prototype's HUD line). Presentation only: it reads
 * state from the pawn and never changes gameplay. Replace with UMG widgets
 * later; they can use the same BlueprintPure getters.
 */
UCLASS()
class MIDNIGHTREIGN_API AMRDrivingHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "MidnightReign|HUD")
	FLinearColor NeonCyan = FLinearColor(0.f, 1.f, 1.f);

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "MidnightReign|HUD")
	FLinearColor NeonPink = FLinearColor(1.f, 0.08f, 0.58f);

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "MidnightReign|HUD")
	bool bShowControlsHint = true;
};
