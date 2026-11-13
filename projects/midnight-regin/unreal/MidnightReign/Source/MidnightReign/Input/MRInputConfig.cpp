#include "Input/MRInputConfig.h"

#include "InputAction.h"
#include "InputCoreTypes.h"
#include "InputMappingContext.h"
#include "InputModifiers.h"

namespace
{
	UInputAction* MakeAction(UObject* Outer, const TCHAR* Name, EInputActionValueType Type)
	{
		UInputAction* Action = NewObject<UInputAction>(Outer, FName(Name));
		Action->ValueType = Type;
		return Action;
	}
}

void UMRInputConfig::BuildDefaults()
{
	if (MappingContext)
	{
		return;
	}

	ThrottleAction = MakeAction(this, TEXT("IA_MR_Throttle"), EInputActionValueType::Axis1D);
	BrakeAction = MakeAction(this, TEXT("IA_MR_Brake"), EInputActionValueType::Axis1D);
	SteerAction = MakeAction(this, TEXT("IA_MR_Steer"), EInputActionValueType::Axis1D);
	NitrousAction = MakeAction(this, TEXT("IA_MR_Nitrous"), EInputActionValueType::Boolean);
	HandbrakeAction = MakeAction(this, TEXT("IA_MR_Handbrake"), EInputActionValueType::Boolean);
	ResetAction = MakeAction(this, TEXT("IA_MR_Reset"), EInputActionValueType::Boolean);

	MappingContext = NewObject<UInputMappingContext>(this, TEXT("IMC_MR_Driving"));

	// Throttle
	MappingContext->MapKey(ThrottleAction, EKeys::W);
	MappingContext->MapKey(ThrottleAction, EKeys::Up);
	MappingContext->MapKey(ThrottleAction, EKeys::Gamepad_RightTriggerAxis);

	// Brake / reverse
	MappingContext->MapKey(BrakeAction, EKeys::S);
	MappingContext->MapKey(BrakeAction, EKeys::Down);
	MappingContext->MapKey(BrakeAction, EKeys::Gamepad_LeftTriggerAxis);

	// Steer: +1 = right, -1 = left
	MappingContext->MapKey(SteerAction, EKeys::D);
	MappingContext->MapKey(SteerAction, EKeys::Right);
	{
		FEnhancedActionKeyMapping& Left = MappingContext->MapKey(SteerAction, EKeys::A);
		Left.Modifiers.Add(NewObject<UInputModifierNegate>(MappingContext));
	}
	{
		FEnhancedActionKeyMapping& Left = MappingContext->MapKey(SteerAction, EKeys::Left);
		Left.Modifiers.Add(NewObject<UInputModifierNegate>(MappingContext));
	}
	{
		FEnhancedActionKeyMapping& Stick = MappingContext->MapKey(SteerAction, EKeys::Gamepad_LeftX);
		UInputModifierDeadZone* DeadZone = NewObject<UInputModifierDeadZone>(MappingContext);
		DeadZone->LowerThreshold = 0.15f;
		Stick.Modifiers.Add(DeadZone);
	}

	// Buttons
	MappingContext->MapKey(NitrousAction, EKeys::SpaceBar);
	MappingContext->MapKey(NitrousAction, EKeys::Gamepad_FaceButton_Bottom);
	MappingContext->MapKey(HandbrakeAction, EKeys::LeftShift);
	MappingContext->MapKey(HandbrakeAction, EKeys::Gamepad_FaceButton_Right);
	MappingContext->MapKey(ResetAction, EKeys::R);
	MappingContext->MapKey(ResetAction, EKeys::Gamepad_FaceButton_Top);
}
