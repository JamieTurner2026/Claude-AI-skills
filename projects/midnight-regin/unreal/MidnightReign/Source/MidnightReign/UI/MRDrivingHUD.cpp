#include "UI/MRDrivingHUD.h"

#include "Engine/Canvas.h"
#include "Vehicles/MRNitrousComponent.h"
#include "Vehicles/MRVehiclePawn.h"

void AMRDrivingHUD::DrawHUD()
{
	Super::DrawHUD();

	const AMRVehiclePawn* Car = Cast<AMRVehiclePawn>(GetOwningPawn());
	if (!Car || !Canvas)
	{
		return;
	}

	const float Width = Canvas->ClipX;
	const float Height = Canvas->ClipY;
	const float UIScale = FMath::Max(Height / 1080.f, 0.5f);

	if (bShowControlsHint)
	{
		DrawText(TEXT("WASD / Arrows: drive   SPACE: nitro   SHIFT: handbrake   R: reset"),
			FLinearColor::White, 24.f * UIScale, 20.f * UIScale, nullptr, 1.2f * UIScale);
	}

	// Speed + gear, bottom right.
	const int32 Speed = FMath::RoundToInt(FMath::Abs(Car->GetSpeedKmh()));
	const int32 Gear = Car->GetCurrentGear();
	const FString GearText = Gear < 0 ? TEXT("R") : (Gear == 0 ? TEXT("N") : FString::FromInt(Gear));

	const float Right = Width - 320.f * UIScale;
	const float Bottom = Height - 170.f * UIScale;
	DrawText(FString::Printf(TEXT("%d"), Speed), NeonCyan, Right, Bottom, nullptr, 5.f * UIScale);
	DrawText(TEXT("KM/H"), FLinearColor::White, Right + 190.f * UIScale, Bottom + 40.f * UIScale, nullptr, 1.5f * UIScale);
	DrawText(GearText, NeonPink, Right + 190.f * UIScale, Bottom, nullptr, 2.5f * UIScale);

	// Nitrous bar.
	if (const UMRNitrousComponent* Nitrous = Car->GetNitrous())
	{
		const float BarX = Right;
		const float BarY = Bottom + 90.f * UIScale;
		const float BarW = 280.f * UIScale;
		const float BarH = 16.f * UIScale;
		DrawRect(FLinearColor(0.f, 0.f, 0.f, 0.6f), BarX - 2.f, BarY - 2.f, BarW + 4.f, BarH + 4.f);
		DrawRect(Nitrous->IsBoosting() ? NeonPink : NeonCyan, BarX, BarY, BarW * Nitrous->GetNitrousFraction(), BarH);
		DrawText(TEXT("NITRO"), FLinearColor::White, BarX, BarY + BarH + 4.f * UIScale, nullptr, 1.1f * UIScale);
	}
}
