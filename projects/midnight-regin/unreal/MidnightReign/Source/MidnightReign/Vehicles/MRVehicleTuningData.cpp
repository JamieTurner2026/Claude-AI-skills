#include "Vehicles/MRVehicleTuningData.h"

#include "ChaosVehicleWheel.h"
#include "ChaosWheeledVehicleMovementComponent.h"
#include "Vehicles/MRWheels.h"

mr::SteeringConfig FMRSteeringSettings::ToCoreConfig() const
{
	mr::SteeringConfig C;
	C.FullLockBelowKmh = FullLockBelowKmh;
	C.MinLockAboveKmh = MinLockAboveKmh;
	C.MinLockScale = MinLockScale;
	C.RiseRate = RiseRate;
	C.ReturnRate = ReturnRate;
	return C;
}

void UMRVehicleTuningData::ApplyTo(UChaosWheeledVehicleMovementComponent* Movement) const
{
	if (!Movement)
	{
		return;
	}

	Movement->Mass = MassKg;
	Movement->DragCoefficient = DragCoefficient;
	Movement->DownforceCoefficient = DownforceCoefficient;
	Movement->bEnableCenterOfMassOverride = true;
	Movement->CenterOfMassOverride = CenterOfMassOffset;

	Movement->EngineSetup.MaxTorque = MaxTorqueNm;
	Movement->EngineSetup.MaxRPM = MaxRPM;
	Movement->EngineSetup.EngineIdleRPM = IdleRPM;
	Movement->EngineSetup.EngineBrakeEffect = EngineBrakeEffect;

	Movement->TransmissionSetup.bUseAutomaticGears = true;
	Movement->TransmissionSetup.bUseAutoReverse = true;
	Movement->TransmissionSetup.FinalRatio = FinalDriveRatio;
	Movement->TransmissionSetup.ChangeUpRPM = ChangeUpRPM;
	Movement->TransmissionSetup.ChangeDownRPM = ChangeDownRPM;
	Movement->TransmissionSetup.GearChangeTime = GearChangeTime;
	if (ForwardGearRatios.Num() > 0)
	{
		Movement->TransmissionSetup.ForwardGearRatios = ForwardGearRatios;
	}
	Movement->TransmissionSetup.ReverseGearRatios = { ReverseGearRatio };

	switch (Drivetrain)
	{
	case EMRDrivetrain::FrontWheelDrive:
		Movement->DifferentialSetup.DifferentialType = EVehicleDifferential::FrontWheelDrive;
		break;
	case EMRDrivetrain::AllWheelDrive:
		Movement->DifferentialSetup.DifferentialType = EVehicleDifferential::AllWheelDrive;
		break;
	default:
		Movement->DifferentialSetup.DifferentialType = EVehicleDifferential::RearWheelDrive;
		break;
	}

	if (WheelBoneNames.Num() == 4)
	{
		const TSubclassOf<UChaosVehicleWheel> Front = FrontWheelClass ? FrontWheelClass : TSubclassOf<UChaosVehicleWheel>(UMRWheelFront::StaticClass());
		const TSubclassOf<UChaosVehicleWheel> Rear = RearWheelClass ? RearWheelClass : TSubclassOf<UChaosVehicleWheel>(UMRWheelRear::StaticClass());

		Movement->WheelSetups.SetNum(4);
		for (int32 Index = 0; Index < 4; ++Index)
		{
			Movement->WheelSetups[Index].WheelClass = Index < 2 ? Front : Rear;
			Movement->WheelSetups[Index].BoneName = WheelBoneNames[Index];
			Movement->WheelSetups[Index].AdditionalOffset = FVector::ZeroVector;
		}
	}
}
