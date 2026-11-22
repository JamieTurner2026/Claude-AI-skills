#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "MRInputConfig.generated.h"

class UInputAction;
class UInputMappingContext;

/**
 * Driving input actions and default key bindings, built in C++ so the project
 * is playable without creating any input assets in the editor.
 *
 *   Throttle   W / Up        / Right Trigger
 *   Brake      S / Down      / Left Trigger      (reverse when stopped)
 *   Steer      A,D / Left,Right / Left Stick X
 *   Nitrous    Space         / Gamepad A (bottom face button)
 *   Handbrake  Left Shift    / Gamepad B (right face button)
 *   Reset car  R             / Gamepad Y (top face button)
 *
 * Mobile: bind on-screen UMG buttons / a virtual joystick to the same actions
 * (or call the pawn's Set*Input functions). Racing wheels arrive through the
 * same Steer/Throttle/Brake axes once a wheel plugin maps them.
 */
UCLASS(BlueprintType)
class MIDNIGHTREIGN_API UMRInputConfig : public UObject
{
	GENERATED_BODY()

public:
	/** Create the actions and the default mapping context. Safe to call once. */
	void BuildDefaults();

	UPROPERTY(BlueprintReadOnly, Category = "Input")
	TObjectPtr<UInputAction> ThrottleAction;

	UPROPERTY(BlueprintReadOnly, Category = "Input")
	TObjectPtr<UInputAction> BrakeAction;

	UPROPERTY(BlueprintReadOnly, Category = "Input")
	TObjectPtr<UInputAction> SteerAction;

	UPROPERTY(BlueprintReadOnly, Category = "Input")
	TObjectPtr<UInputAction> NitrousAction;

	UPROPERTY(BlueprintReadOnly, Category = "Input")
	TObjectPtr<UInputAction> HandbrakeAction;

	UPROPERTY(BlueprintReadOnly, Category = "Input")
	TObjectPtr<UInputAction> ResetAction;

	UPROPERTY(BlueprintReadOnly, Category = "Input")
	TObjectPtr<UInputMappingContext> MappingContext;
};
