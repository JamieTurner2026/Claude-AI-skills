#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "Vehicles/MRNitrousComponent.h"
#include "mr/Steering.h"
#include "MRVehicleTuningData.generated.h"

class UChaosVehicleWheel;
class UChaosWheeledVehicleMovementComponent;

UENUM(BlueprintType)
enum class EMRDrivetrain : uint8
{
	RearWheelDrive,
	FrontWheelDrive,
	AllWheelDrive
};

USTRUCT(BlueprintType)
struct MIDNIGHTREIGN_API FMRSteeringSettings
{
	GENERATED_BODY()

	/** Full steering authority up to this speed. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Steering")
	float FullLockBelowKmh = 40.f;

	/** Steering authority has dropped to MinLockScale by this speed. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Steering")
	float MinLockAboveKmh = 220.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Steering", meta = (ClampMin = "0.05", ClampMax = "1"))
	float MinLockScale = 0.25f;

	/** How fast the steering moves away from centre (input units per second). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Steering", meta = (ClampMin = "0.1"))
	float RiseRate = 4.f;

	/** How fast it returns to centre. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Steering", meta = (ClampMin = "0.1"))
	float ReturnRate = 6.f;

	mr::SteeringConfig ToCoreConfig() const;
};

/**
 * One asset per car: everything that makes it drive the way it does.
 * Create via Content Browser > Miscellaneous > Data Asset > MRVehicleTuningData
 * and assign it on a vehicle Blueprint. Later milestones (catalog, upgrades)
 * reference vehicles by VehicleId.
 */
UCLASS(BlueprintType)
class MIDNIGHTREIGN_API UMRVehicleTuningData : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	/** Stable id used by the vehicle catalog / database (e.g. "solaris_gt"). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Identity")
	FName VehicleId;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Identity")
	FText DisplayName;

	// --- Chassis ---
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Chassis", meta = (ClampMin = "100"))
	float MassKg = 1500.f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Chassis", meta = (ClampMin = "0"))
	float DragCoefficient = 0.32f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Chassis", meta = (ClampMin = "0"))
	float DownforceCoefficient = 0.3f;

	/** Lowering the centre of mass (negative Z, cm) makes the car harder to roll. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Chassis")
	FVector CenterOfMassOffset = FVector(0.f, 0.f, -20.f);

	// --- Engine / transmission ---
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Engine", meta = (ClampMin = "1"))
	float MaxTorqueNm = 650.f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Engine", meta = (ClampMin = "1000"))
	float MaxRPM = 7500.f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Engine", meta = (ClampMin = "100"))
	float IdleRPM = 900.f;

	/** Engine braking when off the throttle (the prototype's "friction"). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Engine", meta = (ClampMin = "0"))
	float EngineBrakeEffect = 0.35f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Transmission")
	EMRDrivetrain Drivetrain = EMRDrivetrain::RearWheelDrive;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Transmission")
	TArray<float> ForwardGearRatios = { 3.6f, 2.2f, 1.55f, 1.2f, 0.95f, 0.78f };

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Transmission")
	float ReverseGearRatio = 3.4f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Transmission")
	float FinalDriveRatio = 3.4f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Transmission")
	float ChangeUpRPM = 6500.f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Transmission")
	float ChangeDownRPM = 2500.f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Transmission", meta = (ClampMin = "0"))
	float GearChangeTime = 0.2f;

	// --- Wheels (order: FL, FR, RL, RR) ---
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Wheels")
	TSubclassOf<UChaosVehicleWheel> FrontWheelClass;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Wheels")
	TSubclassOf<UChaosVehicleWheel> RearWheelClass;

	/** Wheel bone names in the skeletal mesh. Defaults match the engine's Vehicle Template cars. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Wheels")
	TArray<FName> WheelBoneNames = { TEXT("Phys_Wheel_FL"), TEXT("Phys_Wheel_FR"), TEXT("Phys_Wheel_BL"), TEXT("Phys_Wheel_BR") };

	// --- Handling / nitrous ---
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Steering")
	FMRSteeringSettings Steering;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Nitrous")
	FMRNitrousSettings Nitrous;

	/** Copy these values onto a Chaos vehicle movement component. Call before its physics state is created. */
	void ApplyTo(UChaosWheeledVehicleMovementComponent* Movement) const;
};
