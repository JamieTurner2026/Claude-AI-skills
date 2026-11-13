#include "Game/MRGameMode.h"

#include "UI/MRDrivingHUD.h"
#include "Vehicles/MRVehiclePawn.h"

AMRGameMode::AMRGameMode()
{
	DefaultPawnClass = AMRVehiclePawn::StaticClass();
	HUDClass = AMRDrivingHUD::StaticClass();
}
