#pragma once

#include "CoreMinimal.h"
#include "WheeledVehiclePawn.h"
#include "mr/Steering.h"
#include "MRVehiclePawn.generated.h"

class UCameraComponent;
class UChaosWheeledVehicleMovementComponent;
class UMRInputConfig;
class UMRNitrousComponent;
class UMRVehicleTuningData;
class USpringArmComponent;
struct FInputActionValue;

/**
 * The player car. Chaos Vehicles does the physics (weight, momentum, tyre
 * grip, suspension, collisions); this class turns player input into vehicle
 * input, adds speed-dependent steering, nitrous and a chase camera.
 *
 * To use: make a Blueprint subclass, assign a rigged car Skeletal Mesh (+ its
 * wheel Animation Blueprint) on the Mesh component, and optionally a
 * MRVehicleTuningData asset. See docs/editor-setup.md.
 */
UCLASS()
class MIDNIGHTREIGN_API AMRVehiclePawn : public AWheeledVehiclePawn
{
	GENERATED_BODY()

public:
	AMRVehiclePawn();

	virtual void PreRegisterAllComponents() override;
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

	// --- Input (callable from Blueprints, e.g. on-screen touch controls or AI) ---

	/** 0..1 */
	UFUNCTION(BlueprintCallable, Category = "MidnightReign|Input")
	void SetThrottleInput(float Value);

	/** 0..1. Brakes when moving forward, reverses when stopped. */
	UFUNCTION(BlueprintCallable, Category = "MidnightReign|Input")
	void SetBrakeInput(float Value);

	/** -1 (left) .. +1 (right) */
	UFUNCTION(BlueprintCallable, Category = "MidnightReign|Input")
	void SetSteerInput(float Value);

	UFUNCTION(BlueprintCallable, Category = "MidnightReign|Input")
	void SetNitrousInput(bool bPressed);

	UFUNCTION(BlueprintCallable, Category = "MidnightReign|Input")
	void SetHandbrakeInput(bool bPressed);

	/** Put the car back on its wheels where it is, stopped. */
	UFUNCTION(BlueprintCallable, Category = "MidnightReign|Vehicle")
	void ResetVehicle();

	// --- State for HUD / UI (read-only; UI never drives gameplay) ---

	UFUNCTION(BlueprintPure, Category = "MidnightReign|Vehicle")
	float GetSpeedKmh() const;

	/** -1 reverse, 0 neutral, 1.. forward gears */
	UFUNCTION(BlueprintPure, Category = "MidnightReign|Vehicle")
	int32 GetCurrentGear() const;

	UFUNCTION(BlueprintPure, Category = "MidnightReign|Vehicle")
	float GetEngineRPM() const;

	UFUNCTION(BlueprintPure, Category = "MidnightReign|Vehicle")
	UMRNitrousComponent* GetNitrous() const { return Nitrous; }

	UFUNCTION(BlueprintPure, Category = "MidnightReign|Vehicle")
	UChaosWheeledVehicleMovementComponent* GetWheeledMovement() const;

	/** Re-read the Tuning asset (steering + nitrous immediately; engine/wheels need a respawn). */
	UFUNCTION(BlueprintCallable, Category = "MidnightReign|Vehicle")
	void ApplyRuntimeTuning();

	/** Data-driven configuration for this car. Optional: C++ defaults are used when empty. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "MidnightReign|Vehicle")
	TObjectPtr<UMRVehicleTuningData> Tuning;

protected:
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "MidnightReign|Camera")
	TObjectPtr<USpringArmComponent> CameraBoom;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "MidnightReign|Camera")
	TObjectPtr<UCameraComponent> ChaseCamera;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "MidnightReign|Vehicle")
	TObjectPtr<UMRNitrousComponent> Nitrous;

	/** Camera field of view at rest / while boosting. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "MidnightReign|Camera")
	float BaseFOV = 90.f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "MidnightReign|Camera")
	float BoostFOV = 105.f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "MidnightReign|Camera")
	float FOVInterpSpeed = 4.f;

private:
	void OnThrottle(const FInputActionValue& Value);
	void OnBrake(const FInputActionValue& Value);
	void OnSteer(const FInputActionValue& Value);
	void OnNitrous(const FInputActionValue& Value);
	void OnHandbrake(const FInputActionValue& Value);
	void OnReset(const FInputActionValue& Value);

	UPROPERTY(Transient)
	TObjectPtr<UMRInputConfig> InputConfig;

	mr::SteeringConfig SteeringConfig;
	float RawThrottle = 0.f;
	float RawBrake = 0.f;
	float RawSteer = 0.f;
	float SmoothedSteer = 0.f;
	bool bNitrousHeld = false;
	bool bHandbrakeHeld = false;
};
