#include "Vehicles/MRVehiclePawn.h"

#include "Camera/CameraComponent.h"
#include "ChaosWheeledVehicleMovementComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Engine/LocalPlayer.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/SpringArmComponent.h"
#include "Input/MRInputConfig.h"
#include "InputActionValue.h"
#include "MidnightReign.h"
#include "Vehicles/MRNitrousComponent.h"
#include "Vehicles/MRVehicleTuningData.h"
#include "Vehicles/MRWheels.h"

AMRVehiclePawn::AMRVehiclePawn()
{
	PrimaryActorTick.bCanEverTick = true;

	GetMesh()->SetSimulatePhysics(true);
	GetMesh()->SetCollisionProfileName(FName("Vehicle"));

	// Chase camera: follows yaw with lag, ignores pitch/roll so jumps and
	// bumps do not throw the view around.
	CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));
	CameraBoom->SetupAttachment(GetMesh());
	CameraBoom->SetRelativeLocation(FVector(0.f, 0.f, 120.f));
	CameraBoom->SetRelativeRotation(FRotator(-12.f, 0.f, 0.f));
	CameraBoom->TargetArmLength = 650.f;
	CameraBoom->bUsePawnControlRotation = false;
	CameraBoom->bInheritPitch = false;
	CameraBoom->bInheritRoll = false;
	CameraBoom->bInheritYaw = true;
	CameraBoom->bEnableCameraLag = true;
	CameraBoom->CameraLagSpeed = 8.f;
	CameraBoom->bEnableCameraRotationLag = true;
	CameraBoom->CameraRotationLagSpeed = 5.f;
	CameraBoom->bDoCollisionTest = true;

	ChaseCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("ChaseCamera"));
	ChaseCamera->SetupAttachment(CameraBoom, USpringArmComponent::SocketName);
	ChaseCamera->FieldOfView = BaseFOV;

	Nitrous = CreateDefaultSubobject<UMRNitrousComponent>(TEXT("Nitrous"));

	// Sensible C++ defaults so the car drives without a Tuning asset.
	// A Tuning asset, when assigned, overrides these in PreRegisterAllComponents.
	if (UChaosWheeledVehicleMovementComponent* Movement = GetWheeledMovement())
	{
		Movement->Mass = 1500.f;
		Movement->DragCoefficient = 0.32f;
		Movement->DownforceCoefficient = 0.3f;
		Movement->bEnableCenterOfMassOverride = true;
		Movement->CenterOfMassOverride = FVector(0.f, 0.f, -20.f);

		// Brake input reverses once the car has stopped (prototype: S / Down).
		Movement->bReverseAsBrake = true;

		Movement->EngineSetup.MaxTorque = 650.f;
		Movement->EngineSetup.MaxRPM = 7500.f;
		Movement->EngineSetup.EngineIdleRPM = 900.f;
		Movement->EngineSetup.EngineBrakeEffect = 0.35f;

		Movement->TransmissionSetup.bUseAutomaticGears = true;
		Movement->TransmissionSetup.bUseAutoReverse = true;
		Movement->TransmissionSetup.FinalRatio = 3.4f;
		Movement->TransmissionSetup.ForwardGearRatios = { 3.6f, 2.2f, 1.55f, 1.2f, 0.95f, 0.78f };
		Movement->TransmissionSetup.ReverseGearRatios = { 3.4f };
		Movement->TransmissionSetup.ChangeUpRPM = 6500.f;
		Movement->TransmissionSetup.ChangeDownRPM = 2500.f;
		Movement->TransmissionSetup.GearChangeTime = 0.2f;

		Movement->DifferentialSetup.DifferentialType = EVehicleDifferential::RearWheelDrive;
		Movement->SteeringSetup.SteeringType = ESteeringType::Ackermann;

		// Bone names match the engine's Vehicle Template cars; change them in
		// the Tuning asset for your own Blender rigs.
		static const FName DefaultBones[4] = { TEXT("Phys_Wheel_FL"), TEXT("Phys_Wheel_FR"), TEXT("Phys_Wheel_BL"), TEXT("Phys_Wheel_BR") };
		Movement->WheelSetups.SetNum(4);
		for (int32 Index = 0; Index < 4; ++Index)
		{
			Movement->WheelSetups[Index].WheelClass = Index < 2 ? UMRWheelFront::StaticClass() : UMRWheelRear::StaticClass();
			Movement->WheelSetups[Index].BoneName = DefaultBones[Index];
			Movement->WheelSetups[Index].AdditionalOffset = FVector::ZeroVector;
		}
	}
}

UChaosWheeledVehicleMovementComponent* AMRVehiclePawn::GetWheeledMovement() const
{
	return Cast<UChaosWheeledVehicleMovementComponent>(GetVehicleMovementComponent());
}

void AMRVehiclePawn::PreRegisterAllComponents()
{
	Super::PreRegisterAllComponents();

	// Engine, gearbox and wheel setup must be in place before the movement
	// component creates its physics vehicle, i.e. before registration.
	if (Tuning)
	{
		Tuning->ApplyTo(GetWheeledMovement());
	}
}

void AMRVehiclePawn::BeginPlay()
{
	Super::BeginPlay();
	ApplyRuntimeTuning();
}

void AMRVehiclePawn::ApplyRuntimeTuning()
{
	if (Tuning)
	{
		SteeringConfig = Tuning->Steering.ToCoreConfig();
		if (Nitrous)
		{
			Nitrous->ApplySettings(Tuning->Nitrous);
		}
	}
	else
	{
		SteeringConfig = mr::SteeringConfig();
	}
}

void AMRVehiclePawn::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	if (UChaosWheeledVehicleMovementComponent* Movement = GetWheeledMovement())
	{
		// Less steering lock at speed, and smoothed so keyboard taps do not snap the wheels.
		SmoothedSteer = mr::SmoothSteeringInput(SmoothedSteer, RawSteer, SteeringConfig, DeltaSeconds);
		const float Scale = mr::SteeringScaleForSpeed(GetSpeedKmh(), SteeringConfig);

		Movement->SetSteeringInput(SmoothedSteer * Scale);
		Movement->SetThrottleInput(RawThrottle);
		Movement->SetBrakeInput(RawBrake);
		Movement->SetHandbrakeInput(bHandbrakeHeld);
	}

	if (Nitrous)
	{
		Nitrous->SetBoostRequested(bNitrousHeld);
	}

	if (ChaseCamera)
	{
		const float TargetFOV = (Nitrous && Nitrous->IsBoosting()) ? BoostFOV : BaseFOV;
		ChaseCamera->SetFieldOfView(FMath::FInterpTo(ChaseCamera->FieldOfView, TargetFOV, DeltaSeconds, FOVInterpSpeed));
	}
}

void AMRVehiclePawn::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	if (!InputConfig)
	{
		InputConfig = NewObject<UMRInputConfig>(this);
		InputConfig->BuildDefaults();
	}

	if (const APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		if (const ULocalPlayer* LocalPlayer = PC->GetLocalPlayer())
		{
			if (UEnhancedInputLocalPlayerSubsystem* Subsystem = ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(LocalPlayer))
			{
				Subsystem->AddMappingContext(InputConfig->MappingContext, 0);
			}
		}
	}

	UEnhancedInputComponent* Input = Cast<UEnhancedInputComponent>(PlayerInputComponent);
	if (!Input)
	{
		UE_LOG(LogMidnightReign, Error, TEXT("%s needs an EnhancedInputComponent (see Config/DefaultInput.ini)."), *GetName());
		return;
	}

	// Triggered updates the value while held; Completed delivers the zero on release.
	for (const ETriggerEvent Event : { ETriggerEvent::Triggered, ETriggerEvent::Completed })
	{
		Input->BindAction(InputConfig->ThrottleAction, Event, this, &AMRVehiclePawn::OnThrottle);
		Input->BindAction(InputConfig->BrakeAction, Event, this, &AMRVehiclePawn::OnBrake);
		Input->BindAction(InputConfig->SteerAction, Event, this, &AMRVehiclePawn::OnSteer);
		Input->BindAction(InputConfig->NitrousAction, Event, this, &AMRVehiclePawn::OnNitrous);
		Input->BindAction(InputConfig->HandbrakeAction, Event, this, &AMRVehiclePawn::OnHandbrake);
	}
	Input->BindAction(InputConfig->ResetAction, ETriggerEvent::Started, this, &AMRVehiclePawn::OnReset);
}

void AMRVehiclePawn::OnThrottle(const FInputActionValue& Value) { SetThrottleInput(Value.Get<float>()); }
void AMRVehiclePawn::OnBrake(const FInputActionValue& Value) { SetBrakeInput(Value.Get<float>()); }
void AMRVehiclePawn::OnSteer(const FInputActionValue& Value) { SetSteerInput(Value.Get<float>()); }
void AMRVehiclePawn::OnNitrous(const FInputActionValue& Value) { SetNitrousInput(Value.Get<bool>()); }
void AMRVehiclePawn::OnHandbrake(const FInputActionValue& Value) { SetHandbrakeInput(Value.Get<bool>()); }
void AMRVehiclePawn::OnReset(const FInputActionValue& Value) { ResetVehicle(); }

void AMRVehiclePawn::SetThrottleInput(float Value) { RawThrottle = FMath::Clamp(Value, 0.f, 1.f); }
void AMRVehiclePawn::SetBrakeInput(float Value) { RawBrake = FMath::Clamp(Value, 0.f, 1.f); }
void AMRVehiclePawn::SetSteerInput(float Value) { RawSteer = FMath::Clamp(Value, -1.f, 1.f); }
void AMRVehiclePawn::SetNitrousInput(bool bPressed) { bNitrousHeld = bPressed; }
void AMRVehiclePawn::SetHandbrakeInput(bool bPressed) { bHandbrakeHeld = bPressed; }

void AMRVehiclePawn::ResetVehicle()
{
	USkeletalMeshComponent* Body = GetMesh();
	if (!Body)
	{
		return;
	}

	const FVector Location = GetActorLocation() + FVector(0.f, 0.f, 80.f);
	const FRotator Upright(0.f, GetActorRotation().Yaw, 0.f);
	Body->SetWorldLocationAndRotation(Location, Upright, false, nullptr, ETeleportType::TeleportPhysics);
	Body->SetPhysicsLinearVelocity(FVector::ZeroVector);
	Body->SetPhysicsAngularVelocityInDegrees(FVector::ZeroVector);
	SmoothedSteer = 0.f;
}

float AMRVehiclePawn::GetSpeedKmh() const
{
	const UChaosWheeledVehicleMovementComponent* Movement = GetWheeledMovement();
	return Movement ? Movement->GetForwardSpeed() * 0.036f : 0.f; // cm/s -> km/h
}

int32 AMRVehiclePawn::GetCurrentGear() const
{
	const UChaosWheeledVehicleMovementComponent* Movement = GetWheeledMovement();
	return Movement ? Movement->GetCurrentGear() : 0;
}

float AMRVehiclePawn::GetEngineRPM() const
{
	const UChaosWheeledVehicleMovementComponent* Movement = GetWheeledMovement();
	return Movement ? Movement->GetEngineRotationSpeed() : 0.f;
}
