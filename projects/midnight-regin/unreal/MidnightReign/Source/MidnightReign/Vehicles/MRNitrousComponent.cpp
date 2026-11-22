#include "Vehicles/MRNitrousComponent.h"

#include "Components/PrimitiveComponent.h"
#include "GameFramework/Actor.h"

mr::NitrousConfig FMRNitrousSettings::ToCoreConfig() const
{
	mr::NitrousConfig C;
	C.Capacity = Capacity;
	C.DrainPerSec = DrainPerSecond;
	C.RechargePerSec = RechargePerSecond;
	C.RechargeDelay = RechargeDelay;
	C.MinToActivate = MinToActivate;
	return C;
}

UMRNitrousComponent::UMRNitrousComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.TickGroup = TG_PrePhysics;
}

void UMRNitrousComponent::BeginPlay()
{
	Super::BeginPlay();
	Tank = mr::NitrousTank(Settings.ToCoreConfig());
}

void UMRNitrousComponent::SetBoostRequested(bool bRequested)
{
	bBoostRequested = bRequested;
}

void UMRNitrousComponent::ApplySettings(const FMRNitrousSettings& NewSettings)
{
	Settings = NewSettings;
	Tank.SetConfig(Settings.ToCoreConfig());
}

void UMRNitrousComponent::Refill()
{
	Tank.SetAmount(Tank.GetConfig().Capacity);
}

void UMRNitrousComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	AActor* Owner = GetOwner();
	UPrimitiveComponent* Body = Owner ? Cast<UPrimitiveComponent>(Owner->GetRootComponent()) : nullptr;

	float ForwardSpeed = 0.f; // cm/s
	FVector Forward = FVector::ForwardVector;
	if (Body)
	{
		Forward = Owner->GetActorForwardVector();
		ForwardSpeed = static_cast<float>(FVector::DotProduct(Body->GetPhysicsLinearVelocity(), Forward));
	}

	const bool bCanBoost = Body != nullptr && ForwardSpeed > MinForwardSpeedToBoost;
	const mr::NitrousEvents Events = Tank.Update(bBoostRequested, bCanBoost, DeltaTime);
	bBoosting = Events.bBoosting;

	if (bBoosting && Body && Body->IsSimulatingPhysics())
	{
		const float SpeedKmh = ForwardSpeed * 0.036f;
		if (SpeedKmh < Settings.MaxBoostSpeedKmh)
		{
			// bAccelChange = true: acceleration in cm/s^2, independent of vehicle mass.
			Body->AddForce(Forward * Settings.BoostAcceleration, NAME_None, true);
		}
	}

	if (Events.bActivated)
	{
		OnBoostStarted.Broadcast();
	}
	if (Events.bDepleted)
	{
		OnDepleted.Broadcast();
	}
	if (Events.bDeactivated)
	{
		OnBoostStopped.Broadcast();
	}
}
