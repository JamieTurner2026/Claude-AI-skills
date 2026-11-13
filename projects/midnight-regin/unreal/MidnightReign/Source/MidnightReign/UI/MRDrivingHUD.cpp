#include "UI/MRDrivingHUD.h"

#include "Engine/Canvas.h"
#include "EngineUtils.h"
#include "Race/MRRaceManager.h"
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

	if (!CachedRace.IsValid())
	{
		for (TActorIterator<AMRRaceManager> It(GetWorld()); It; ++It) { CachedRace = *It; break; }
	}
	if (CachedRace.IsValid())
	{
		DrawRace(*CachedRace, Width, Height, UIScale);
	}

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

FString AMRDrivingHUD::FormatTime(float Seconds)
{
	if (Seconds < 0.f) return TEXT("--:--.---");
	const int32 Minutes = FMath::FloorToInt(Seconds / 60.f);
	return FString::Printf(TEXT("%d:%06.3f"), Minutes, Seconds - Minutes * 60.f);
}

void AMRDrivingHUD::DrawRace(const AMRRaceManager& Race, float Width, float Height, float UIScale)
{
	const EMRRacePhase Phase = Race.GetPhase();

	// Position / lap / timers, top right.
	const float X = Width - 420.f * UIScale;
	float Y = 30.f * UIScale;
	DrawText(FString::Printf(TEXT("P%d / %d"), FMath::Max(Race.GetPlayerPosition(), 1), Race.GetRacerCount()),
		NeonPink, X, Y, nullptr, 3.f * UIScale);
	Y += 70.f * UIScale;
	DrawText(FString::Printf(TEXT("LAP %d / %d"), Race.GetPlayerLap(), Race.TotalLaps), NeonCyan, X, Y, nullptr, 2.f * UIScale);
	Y += 45.f * UIScale;
	DrawText(FString::Printf(TEXT("TIME  %s"), *FormatTime(Race.GetRaceTime())), FLinearColor::White, X, Y, nullptr, 1.4f * UIScale);
	Y += 32.f * UIScale;
	DrawText(FString::Printf(TEXT("LAP   %s"), *FormatTime(Race.GetPlayerCurrentLap())), FLinearColor::White, X, Y, nullptr, 1.4f * UIScale);
	Y += 32.f * UIScale;
	DrawText(FString::Printf(TEXT("LAST  %s"), *FormatTime(Race.GetPlayerLastLap())), FLinearColor::White, X, Y, nullptr, 1.4f * UIScale);
	Y += 32.f * UIScale;
	DrawText(FString::Printf(TEXT("BEST  %s"), *FormatTime(Race.GetPlayerBestLap())), NeonCyan, X, Y, nullptr, 1.4f * UIScale);

	// Countdown / GO / wrong way, centre.
	if (Phase == EMRRacePhase::Countdown)
	{
		DrawText(FString::FromInt(FMath::Max(Race.GetCountdownNumber(), 1)), NeonPink,
			Width * 0.5f - 40.f * UIScale, Height * 0.3f, nullptr, 8.f * UIScale);
	}
	else if (Phase == EMRRacePhase::Racing && Race.GetRaceTime() < 1.f)
	{
		DrawText(TEXT("GO!"), NeonCyan, Width * 0.5f - 90.f * UIScale, Height * 0.3f, nullptr, 8.f * UIScale);
	}
	if (Phase == EMRRacePhase::Racing && Race.IsPlayerWrongWay())
	{
		DrawText(TEXT("WRONG WAY"), FLinearColor::Red, Width * 0.5f - 200.f * UIScale, Height * 0.2f, nullptr, 4.f * UIScale);
	}

	// Results table.
	if (Phase == EMRRacePhase::Finished && Race.HasResults())
	{
		const float PanelW = 760.f * UIScale;
		const float PanelX = (Width - PanelW) * 0.5f;
		float RowY = Height * 0.18f;
		DrawRect(FLinearColor(0.f, 0.f, 0.f, 0.75f), PanelX - 20.f * UIScale, RowY - 20.f * UIScale,
			PanelW + 40.f * UIScale, (Race.GetResults().Num() + 2) * 46.f * UIScale + 40.f * UIScale);
		DrawText(TEXT("RESULTS"), NeonPink, PanelX, RowY, nullptr, 3.f * UIScale);
		RowY += 70.f * UIScale;
		for (const FMRResultRow& Row : Race.GetResults())
		{
			const FString Time = Row.bFinished
				? (Row.Position == 1 ? FormatTime(Row.TotalTime) : FString::Printf(TEXT("+%.3f"), Row.GapToWinner))
				: FString::Printf(TEXT("DNF  (%d lap%s behind)"), Row.LapsBehind, Row.LapsBehind == 1 ? TEXT("") : TEXT("s"));
			DrawText(FString::Printf(TEXT("%d.  %-8s %-22s best %s"), Row.Position, *Row.Name, *Time, *FormatTime(Row.BestLap)),
				Row.bIsPlayer ? NeonCyan : FLinearColor::White, PanelX, RowY, nullptr, 1.5f * UIScale);
			RowY += 46.f * UIScale;
		}
		DrawText(TEXT("Stop and re-play the level to race again."), FLinearColor::White, PanelX, RowY + 10.f * UIScale, nullptr, 1.1f * UIScale);
	}
}
