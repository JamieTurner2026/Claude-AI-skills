#include "Race/MRRaceManager.h"

#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "Race/MRAIDriverComponent.h"
#include "Vehicles/MRVehiclePawn.h"

AMRRaceManager::AMRRaceManager()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickGroup = TG_PostPhysics;   // read car positions after the physics step
}

void AMRRaceManager::BeginPlay()
{
	Super::BeginPlay();
	Clock = mr::RaceClock(CountdownSeconds);
	BuildCoreData();
	SpawnOpponents();
	TryRegisterPlayer();
	StartTimer = StartDelaySeconds;
}

void AMRRaceManager::BuildCoreData()
{
	CoreGates.Reset();
	for (const FMRGateDef& G : Gates)
	{
		mr::Gate Out;
		Out.X = G.Location.X;
		Out.Y = G.Location.Y;
		const float Yaw = FMath::DegreesToRadians(G.YawDegrees);
		Out.DirX = FMath::Cos(Yaw);
		Out.DirY = FMath::Sin(Yaw);
		Out.HalfWidth = GateHalfWidthCm;
		CoreGates.Add(Out);
	}
	Line.Reset();
	for (const FVector2D& P : RacingLine)
	{
		mr::LinePoint Pt;
		Pt.X = P.X;
		Pt.Y = P.Y;
		Line.Add(Pt);
	}
	if (Line.Num() >= 3)
	{
		mr::ComputeLineRadii(Line.GetData(), Line.Num());
	}
	if (CoreGates.Num() == 0 || CoreGates.Num() > mr::MaxCheckpoints)
	{
		UE_LOG(LogTemp, Error, TEXT("MRRaceManager %s needs 1..%d gates (run Scripts/setup_visuals.py)."), *GetName(), mr::MaxCheckpoints);
	}
}

void AMRRaceManager::SpawnOpponents()
{
	if (!AIVehicleClass || !GetWorld()) return;

	const int32 Count = FMath::Min(NumOpponents, mr::MaxRacers - 1);
	for (int32 i = 0; i < Count; ++i)
	{
		// Grid slot 0 is pole; the player starts at the last slot (see track_layout.json player_start).
		if (!Grid.IsValidIndex(i)) break;
		const FMRGridSlot& Slot = Grid[i];

		FActorSpawnParameters Params;
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
		AMRVehiclePawn* Car = GetWorld()->SpawnActor<AMRVehiclePawn>(
			AIVehicleClass, Slot.Location + FVector(0.f, 0.f, 60.f), FRotator(0.f, Slot.YawDegrees, 0.f), Params);
		if (!Car) continue;

		FRacer R;
		R.Id = Racers.Num();
		R.Name = FString::Printf(TEXT("RIVAL %d"), i + 1);
		R.Pawn = Car;

		UMRAIDriverComponent* Driver = NewObject<UMRAIDriverComponent>(Car);
		Driver->RacerId = R.Id;
		Driver->Skill = FMath::Max(BaseAISkill - 0.04f * i, 0.5f);
		Driver->Manager = this;
		Driver->RegisterComponent();
		Racers.Add(R);
	}
}

bool AMRRaceManager::TryRegisterPlayer()
{
	if (bPlayerRegistered) return true;
	AMRVehiclePawn* Car = Cast<AMRVehiclePawn>(UGameplayStatics::GetPlayerPawn(this, 0));
	if (!Car) return false;

	FRacer R;
	R.Id = Racers.Num();
	R.Name = TEXT("YOU");
	R.bIsPlayer = true;
	R.Pawn = Car;
	Racers.Add(R);
	bPlayerRegistered = true;
	return true;
}

void AMRRaceManager::StartCountdown()
{
	bCountdownScheduled = true;
	Clock.StartCountdown();
}

void AMRRaceManager::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	if (!TryRegisterPlayer()) return;   // wait until the player's car exists

	if (!bCountdownScheduled)
	{
		StartTimer -= DeltaSeconds;
		if (StartTimer <= 0.f) StartCountdown();
	}

	const bool bWasRacing = IsRacing();
	const mr::RaceClockEvents Ev = Clock.Update(DeltaSeconds);
	if (Ev.bCountdownTick) OnCountdownTick.Broadcast(Ev.CountdownNumber);
	if (Ev.bGo) OnRaceGo.Broadcast();

	// Cars may not move before GO.
	const bool bLocked = Clock.AreInputsLocked();
	for (FRacer& R : Racers)
	{
		if (AMRVehiclePawn* Car = R.Pawn.Get()) Car->SetInputsLocked(bLocked);
	}

	if (!IsRacing() && !bWasRacing) return;

	if (IsRacing())
	{
		for (FRacer& R : Racers) UpdateRacer(R, DeltaSeconds);
		RefreshStandings();

		const FRacer* Player = GetPlayerRacer();
		if (Player && Player->Progress.bFinished && !bGraceStarted)
		{
			bGraceStarted = true;
			GraceTimer = FinishGraceSeconds;
		}
		if (bGraceStarted) GraceTimer -= DeltaSeconds;

		bool bAllDone = true;
		for (const FRacer& R : Racers) bAllDone &= R.Progress.bFinished;
		if (bAllDone || (bGraceStarted && GraceTimer <= 0.f)) CloseRace();
	}
}

void AMRRaceManager::UpdateRacer(FRacer& R, float DeltaSeconds)
{
	const AMRVehiclePawn* Car = R.Pawn.Get();
	if (!Car) return;

	const FVector Cur = Car->GetActorLocation();
	if (R.bHasLast && !R.Progress.bFinished && CoreGates.IsValidIndex(R.Progress.NextCheckpoint))
	{
		const int32 Index = R.Progress.NextCheckpoint;
		if (mr::GateCrossing(CoreGates[Index], R.LastLocation.X, R.LastLocation.Y, Cur.X, Cur.Y) > 0)
		{
			OnCheckpointResult(R, mr::PassCheckpoint(R.Progress, Index, CoreGates.Num(), TotalLaps), Index);
		}
	}
	R.LastLocation = Cur;
	R.bHasLast = true;

	// Wrong-way warning for the player: facing away from the next checkpoint.
	if (R.bIsPlayer && CoreGates.IsValidIndex(R.Progress.NextCheckpoint))
	{
		const mr::Gate& Next = CoreGates[R.Progress.NextCheckpoint];
		FVector2D ToNext(Next.X - Cur.X, Next.Y - Cur.Y);
		if (ToNext.Normalize())
		{
			const FVector Fwd = Car->GetActorForwardVector();
			const float Dot = Fwd.X * ToNext.X + Fwd.Y * ToNext.Y;
			R.bWrongWay = R.WrongWay.Update(Dot, Car->GetVelocity().Size(), DeltaSeconds);
		}
	}
}

void AMRRaceManager::OnCheckpointResult(FRacer& R, mr::CheckpointResult Result, int32 Index)
{
	const float Now = Clock.GetRaceTime();
	switch (Result)
	{
	case mr::CheckpointResult::Advanced:
	{
		float Delta = 0.f;
		R.Laps.OnCheckpoint(Index, Now, Delta);
		break;
	}
	case mr::CheckpointResult::LapCompleted:
	{
		const float LapTime = R.Laps.OnLapCompleted(Now);
		if (R.bIsPlayer) OnPlayerLapCompleted.Broadcast(R.Progress.LapsCompleted, LapTime);
		break;
	}
	case mr::CheckpointResult::RaceFinished:
	{
		const float LapTime = R.Laps.OnLapCompleted(Now);
		R.FinishTime = Now;
		if (R.bIsPlayer) OnPlayerLapCompleted.Broadcast(R.Progress.LapsCompleted, LapTime);
		break;
	}
	default:
		break;
	}
}

void AMRRaceManager::RefreshStandings()
{
	Standings.SetNum(Racers.Num());
	for (int32 i = 0; i < Racers.Num(); ++i)
	{
		const FRacer& R = Racers[i];
		mr::RacerStanding& S = Standings[i];
		S.RacerId = R.Id;
		S.CheckpointsPassed = R.Progress.CheckpointsPassed;
		S.LapsCompleted = R.Progress.LapsCompleted;
		S.bFinished = R.Progress.bFinished;
		S.FinishTime = R.FinishTime;
		S.BestLap = R.Laps.GetBestLap();
		S.DistanceToNext = 0.f;
		if (const AMRVehiclePawn* Car = R.Pawn.Get())
		{
			if (CoreGates.IsValidIndex(R.Progress.NextCheckpoint))
			{
				const mr::Gate& G = CoreGates[R.Progress.NextCheckpoint];
				const FVector L = Car->GetActorLocation();
				S.DistanceToNext = FMath::Sqrt(FMath::Square(G.X - L.X) + FMath::Square(G.Y - L.Y));
			}
		}
	}
	mr::SortStandings(Standings.GetData(), Standings.Num());
}

void AMRRaceManager::CloseRace()
{
	if (Clock.GetPhase() == mr::RacePhase::Finished) return;
	RefreshStandings();
	Clock.Finish();

	TArray<mr::ResultRow> Rows;
	Rows.SetNum(Standings.Num());
	mr::BuildResults(Standings.GetData(), Standings.Num(), Rows.GetData());

	Results.Reset();
	for (const mr::ResultRow& Row : Rows)
	{
		FMRResultRow Out;
		Out.Position = Row.Position;
		if (const FRacer* R = FindRacer(Row.RacerId))
		{
			Out.Name = R->Name;
			Out.bIsPlayer = R->bIsPlayer;
		}
		Out.bFinished = Row.bFinished;
		Out.TotalTime = Row.TotalTime;
		Out.GapToWinner = Row.GapToWinner;
		Out.LapsBehind = Row.LapsBehind;
		Out.BestLap = Row.BestLap;
		Results.Add(Out);
	}
	OnRaceFinished.Broadcast();
}

float AMRRaceManager::ProgressCm(const FRacer& R) const
{
	const AMRVehiclePawn* Car = R.Pawn.Get();
	if (!Car || Line.Num() < 3) return 0.f;

	const FVector L = Car->GetActorLocation();
	int32 Nearest = 0;
	float Best = TNumericLimits<float>::Max();
	for (int32 i = 0; i < Line.Num(); ++i)
	{
		const float D = FMath::Square(Line[i].X - L.X) + FMath::Square(Line[i].Y - L.Y);
		if (D < Best) { Best = D; Nearest = i; }
	}
	const float Spacing = LapLengthCm / Line.Num();
	float S = Nearest * Spacing;
	if (!R.Progress.bCrossedStart && S > LapLengthCm * 0.5f) S -= LapLengthCm;   // still behind the start line
	return R.Progress.LapsCompleted * LapLengthCm + S;
}

const AMRRaceManager::FRacer* AMRRaceManager::FindRacer(int32 Id) const
{
	return Racers.FindByPredicate([Id](const FRacer& R) { return R.Id == Id; });
}

const AMRRaceManager::FRacer* AMRRaceManager::GetPlayerRacer() const
{
	return Racers.FindByPredicate([](const FRacer& R) { return R.bIsPlayer; });
}

EMRRacePhase AMRRaceManager::GetPhase() const
{
	switch (Clock.GetPhase())
	{
	case mr::RacePhase::Countdown: return EMRRacePhase::Countdown;
	case mr::RacePhase::Racing: return EMRRacePhase::Racing;
	case mr::RacePhase::Finished: return EMRRacePhase::Finished;
	default: return EMRRacePhase::Waiting;
	}
}

int32 AMRRaceManager::GetPlayerPosition() const
{
	const FRacer* P = GetPlayerRacer();
	return P && Standings.Num() > 0 ? mr::PositionOf(Standings.GetData(), Standings.Num(), P->Id) : 0;
}

int32 AMRRaceManager::GetPlayerLap() const
{
	const FRacer* P = GetPlayerRacer();
	return P ? mr::DisplayLap(P->Progress, TotalLaps) : 1;
}

float AMRRaceManager::GetPlayerCurrentLap() const
{
	const FRacer* P = GetPlayerRacer();
	return P ? P->Laps.GetCurrentLapTime(Clock.GetRaceTime()) : 0.f;
}

float AMRRaceManager::GetPlayerLastLap() const { const FRacer* P = GetPlayerRacer(); return P ? P->Laps.GetLastLap() : -1.f; }
float AMRRaceManager::GetPlayerBestLap() const { const FRacer* P = GetPlayerRacer(); return P ? P->Laps.GetBestLap() : -1.f; }
bool AMRRaceManager::IsPlayerWrongWay() const { const FRacer* P = GetPlayerRacer(); return P && P->bWrongWay; }

bool AMRRaceManager::IsRacerFinished(int32 RacerId) const
{
	const FRacer* R = FindRacer(RacerId);
	return R && R->Progress.bFinished;
}

float AMRRaceManager::GetGapToPlayerCm(int32 RacerId) const
{
	const FRacer* P = GetPlayerRacer();
	const FRacer* R = FindRacer(RacerId);
	if (!P || !R || P->Progress.bFinished) return 0.f;
	return ProgressCm(*P) - ProgressCm(*R);
}
