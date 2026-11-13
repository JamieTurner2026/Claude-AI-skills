#include "Vehicles/MRWheels.h"

// Starting values for a ~1500 kg street car. Hybrid arcade/sim: more grip than
// a real tyre (FrictionForceMultiplier > 1), firm suspension, generous brakes.

UMRWheelFront::UMRWheelFront()
{
	AxleType = EAxleType::Front;
	bAffectedBySteering = true;
	MaxSteerAngle = 40.f;
	bAffectedByEngine = false;
	bAffectedByHandbrake = false;

	WheelRadius = 36.f;
	WheelWidth = 24.f;
	FrictionForceMultiplier = 3.2f;
	CorneringStiffness = 1000.f;

	MaxBrakeTorque = 4500.f;
	MaxHandBrakeTorque = 0.f;

	SuspensionMaxRaise = 10.f;
	SuspensionMaxDrop = 10.f;
	SpringRate = 250.f;
	SuspensionDampingRatio = 0.5f;
	WheelLoadRatio = 0.5f;
}

UMRWheelRear::UMRWheelRear()
{
	AxleType = EAxleType::Rear;
	bAffectedBySteering = false;
	bAffectedByEngine = true;
	bAffectedByHandbrake = true;

	WheelRadius = 36.f;
	WheelWidth = 26.f;
	FrictionForceMultiplier = 3.0f;
	CorneringStiffness = 1000.f;

	MaxBrakeTorque = 3500.f;
	MaxHandBrakeTorque = 6000.f;

	SuspensionMaxRaise = 10.f;
	SuspensionMaxDrop = 10.f;
	SpringRate = 250.f;
	SuspensionDampingRatio = 0.5f;
	WheelLoadRatio = 0.5f;
}
