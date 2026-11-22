#include "Race/MRAIDriverComponent.h"

#include "Race/MRRaceManager.h"
#include "Vehicles/MRVehiclePawn.h"

UMRAIDriverComponent::UMRAIDriverComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.TickGroup = TG_PrePhysics;
}

void UMRAIDriverComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	AMRVehiclePawn* Car = Cast<AMRVehiclePawn>(GetOwner());
	if (!Car || !Manager) return;

	// Not racing (before GO) or already finished: stop and wait.
	if (!Manager->IsRacing() || Manager->IsRacerFinished(RacerId))
	{
		Car->SetThrottleInput(0.f);
		Car->SetBrakeInput(Manager->IsRacing() ? 0.6f : 0.f);
		Car->SetSteerInput(0.f);
		Car->SetNitrousInput(false);
		return;
	}

	const TArray<mr::LinePoint>& Line = Manager->GetLine();
	const FVector Loc = Car->GetActorLocation();
	const FVector Fwd = Car->GetActorForwardVector();

	mr::AIDriverConfig Config;
	Config.Skill = Skill;
	Config.TopSpeed = TopSpeedKmh * 100000.f / 3600.f;   // km/h -> cm/s
	Config.Wheelbase = WheelbaseCm;
	Config.MaxSteerAngleDeg = MaxSteerAngleDeg;

	mr::AIDriverInput In;
	In.X = Loc.X;
	In.Y = Loc.Y;
	const FVector2D Dir = FVector2D(Fwd.X, Fwd.Y).GetSafeNormal();
	In.ForwardX = Dir.X;
	In.ForwardY = Dir.Y;
	In.Speed = Car->GetVelocity().Size();
	In.GapToPlayer = Manager->GetGapToPlayerCm(RacerId);

	const mr::AIDriverOutput Out = Driver.Update(In, Line.GetData(), Line.Num(), Config);
	Car->SetThrottleInput(Out.Throttle);
	Car->SetBrakeInput(Out.Brake);
	Car->SetSteerInput(Out.Steer);   // positive = right, same as the player's input
}
