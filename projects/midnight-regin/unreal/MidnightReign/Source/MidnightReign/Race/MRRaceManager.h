#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "mr/AIDriver.h"
#include "mr/Checkpoints.h"
#include "mr/LapTimer.h"
#include "mr/Race.h"
#include "mr/Standings.h"
#include "MRRaceManager.generated.h"

class AMRVehiclePawn;

UENUM(BlueprintType)
enum class EMRRacePhase : uint8 { Waiting, Countdown, Racing, Finished };

/** A checkpoint line on the track (data comes from assets/export/track_layout.json). */
USTRUCT(BlueprintType)
struct FMRGateDef
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite) FVector2D Location = FVector2D::ZeroVector;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float YawDegrees = 0.f;
};

/** Where a car starts: world location (cm) and yaw. */
USTRUCT(BlueprintType)
struct FMRGridSlot
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite) FVector Location = FVector::ZeroVector;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float YawDegrees = 0.f;
};

/** One row of the results screen. */
USTRUCT(BlueprintType)
struct FMRResultRow
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly) int32 Position = 0;
	UPROPERTY(BlueprintReadOnly) FString Name;
	UPROPERTY(BlueprintReadOnly) bool bIsPlayer = false;
	UPROPERTY(BlueprintReadOnly) bool bFinished = false;
	UPROPERTY(BlueprintReadOnly) float TotalTime = 0.f;
	UPROPERTY(BlueprintReadOnly) float GapToWinner = 0.f;
	UPROPERTY(BlueprintReadOnly) int32 LapsBehind = 0;
	UPROPERTY(BlueprintReadOnly) float BestLap = -1.f;
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FMRCountdownTick, int32, Number);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FMRRaceGo);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FMRLapCompleted, int32, LapNumber, float, LapTime);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FMRRaceFinished);

/**
 * Runs one race: spawns the opponents on the grid, runs the countdown, detects checkpoint
 * crossings, times laps, ranks racers and builds the results. All rules live in core/ (mr::);
 * this actor only feeds them positions and exposes the state to the HUD and Blueprints.
 *
 * Place one in the level. tools: Scripts/setup_visuals.py fills in gates, racing line and grid
 * from track_layout.json.
 */
UCLASS()
class MIDNIGHTREIGN_API AMRRaceManager : public AActor
{
	GENERATED_BODY()

public:
	AMRRaceManager();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	// --- Track data (from track_layout.json) ---
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "MidnightReign|Race") TArray<FMRGateDef> Gates;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "MidnightReign|Race") TArray<FVector2D> RacingLine;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "MidnightReign|Race") TArray<FMRGridSlot> Grid;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "MidnightReign|Race") float GateHalfWidthCm = 1000.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "MidnightReign|Race") float LapLengthCm = 117684.f;

	// --- Rules ---
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "MidnightReign|Race") int32 TotalLaps = 3;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "MidnightReign|Race") float CountdownSeconds = 3.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "MidnightReign|Race") float StartDelaySeconds = 2.f;
	/** After the player finishes, stragglers get this long before the race is closed. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "MidnightReign|Race") float FinishGraceSeconds = 20.f;

	// --- Opponents ---
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "MidnightReign|AI") TSubclassOf<AMRVehiclePawn> AIVehicleClass;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "MidnightReign|AI", meta = (ClampMin = "0", ClampMax = "5")) int32 NumOpponents = 3;
	/** Skill of the first opponent; each further one is 0.04 lower. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "MidnightReign|AI") float BaseAISkill = 0.95f;

	// --- Events ---
	UPROPERTY(BlueprintAssignable) FMRCountdownTick OnCountdownTick;
	UPROPERTY(BlueprintAssignable) FMRRaceGo OnRaceGo;
	UPROPERTY(BlueprintAssignable) FMRLapCompleted OnPlayerLapCompleted;
	UPROPERTY(BlueprintAssignable) FMRRaceFinished OnRaceFinished;

	// --- State for HUD / UI (read-only) ---
	UFUNCTION(BlueprintPure, Category = "MidnightReign|Race") EMRRacePhase GetPhase() const;
	UFUNCTION(BlueprintPure, Category = "MidnightReign|Race") float GetRaceTime() const { return Clock.GetRaceTime(); }
	UFUNCTION(BlueprintPure, Category = "MidnightReign|Race") int32 GetCountdownNumber() const { return mr::CeilToInt(Clock.GetCountdownRemaining()); }
	UFUNCTION(BlueprintPure, Category = "MidnightReign|Race") int32 GetRacerCount() const { return Racers.Num(); }
	UFUNCTION(BlueprintPure, Category = "MidnightReign|Race") int32 GetPlayerPosition() const;
	UFUNCTION(BlueprintPure, Category = "MidnightReign|Race") int32 GetPlayerLap() const;
	UFUNCTION(BlueprintPure, Category = "MidnightReign|Race") float GetPlayerCurrentLap() const;
	UFUNCTION(BlueprintPure, Category = "MidnightReign|Race") float GetPlayerLastLap() const;
	UFUNCTION(BlueprintPure, Category = "MidnightReign|Race") float GetPlayerBestLap() const;
	UFUNCTION(BlueprintPure, Category = "MidnightReign|Race") bool IsPlayerWrongWay() const;
	UFUNCTION(BlueprintPure, Category = "MidnightReign|Race") bool HasResults() const { return Results.Num() > 0; }
	UFUNCTION(BlueprintPure, Category = "MidnightReign|Race") TArray<FMRResultRow> GetResults() const { return Results; }

	// --- Used by the AI cars ---
	bool IsRacing() const { return Clock.GetPhase() == mr::RacePhase::Racing; }
	bool IsRacerFinished(int32 RacerId) const;
	/** > 0: the player is this far (cm) ahead of the racer. 0 when there is no player. */
	float GetGapToPlayerCm(int32 RacerId) const;
	const TArray<mr::LinePoint>& GetLine() const { return Line; }

private:
	struct FRacer
	{
		int32 Id = 0;
		FString Name;
		bool bIsPlayer = false;
		TWeakObjectPtr<AMRVehiclePawn> Pawn;
		mr::RacerProgress Progress;
		mr::LapTimer Laps;
		mr::WrongWayDetector WrongWay;
		bool bWrongWay = false;
		float FinishTime = 0.f;
		FVector LastLocation = FVector::ZeroVector;
		bool bHasLast = false;
	};

	void BuildCoreData();
	void SpawnOpponents();
	bool TryRegisterPlayer();
	void StartCountdown();
	void UpdateRacer(FRacer& R, float DeltaSeconds);
	void OnCheckpointResult(FRacer& R, mr::CheckpointResult Result, int32 Index);
	void RefreshStandings();
	void CloseRace();
	float ProgressCm(const FRacer& R) const;
	const FRacer* FindRacer(int32 Id) const;
	const FRacer* GetPlayerRacer() const;

	mr::RaceClock Clock;
	TArray<mr::Gate> CoreGates;
	TArray<mr::LinePoint> Line;
	TArray<FRacer> Racers;
	TArray<mr::RacerStanding> Standings;
	TArray<FMRResultRow> Results;
	bool bPlayerRegistered = false;
	bool bCountdownScheduled = false;
	float StartTimer = 0.f;
	bool bGraceStarted = false;
	float GraceTimer = 0.f;
};
