// Dependency-free tests for the engine-independent core.
#include <cmath>
#include <cstdio>

#include "mr/DrivingModel.h"
#include "mr/Nitrous.h"
#include "mr/Steering.h"
#include "test_harness.h"

static void TestNitrousDrainAndEvents()
{
	mr::NitrousTank Tank;
	CHECK_NEAR(Tank.GetFraction(), 1.0, 1e-6);

	mr::NitrousEvents Ev = Tank.Update(true, true, 0.01f);
	CHECK(Ev.bBoosting && Ev.bActivated && !Ev.bDeactivated && !Ev.bDepleted);
	Ev = Tank.Update(true, true, 0.01f);
	CHECK(Ev.bBoosting && !Ev.bActivated);

	float T = 0.02f;
	bool bSawDepleted = false;
	for (int i = 0; i < 1000 && !bSawDepleted; ++i)
	{
		Ev = Tank.Update(true, true, 0.01f);
		T += 0.01f;
		bSawDepleted = Ev.bDepleted;
	}
	CHECK(bSawDepleted);
	CHECK(Ev.bDeactivated);
	CHECK_NEAR(T, 4.0, 0.05); // 100 / 25 per second
	CHECK_NEAR(Tank.GetAmount(), 0.0, 1e-6);
	CHECK(!Tank.IsActive());

	Ev = Tank.Update(true, true, 0.01f);
	CHECK(!Ev.bBoosting && !Ev.bActivated && !Ev.bDeactivated);
}

static void TestNitrousRecharge()
{
	mr::NitrousTank Tank;
	for (int i = 0; i < 500; ++i) Tank.Update(true, true, 0.01f); // drain fully

	// Holding the input never refills.
	for (int i = 0; i < 1000; ++i) Tank.Update(true, true, 0.01f);
	CHECK_NEAR(Tank.GetAmount(), 0.0, 1e-6);

	// Released: nothing during the delay, then a steady refill to capacity.
	for (int i = 0; i < 140; ++i) Tank.Update(false, true, 0.01f);
	CHECK_NEAR(Tank.GetAmount(), 0.0, 1e-6);
	for (int i = 0; i < 110; ++i) Tank.Update(false, true, 0.01f);
	CHECK_NEAR(Tank.GetAmount(), 8.0, 0.2); // 1 s at 8 per second
	for (int i = 0; i < 2000; ++i) Tank.Update(false, true, 0.01f);
	CHECK_NEAR(Tank.GetAmount(), 100.0, 1e-4);
}

static void TestNitrousGating()
{
	mr::NitrousTank Tank;
	// Not allowed (e.g. stationary / reversing): no boost, no drain.
	mr::NitrousEvents Ev = Tank.Update(true, false, 0.5f);
	CHECK(!Ev.bBoosting);
	CHECK_NEAR(Tank.GetAmount(), 100.0, 1e-6);

	Tank.SetAmount(5.f);
	CHECK(!Tank.Update(true, true, 0.01f).bBoosting); // below MinToActivate
	Tank.SetAmount(10.f);
	CHECK(Tank.Update(true, true, 0.01f).bBoosting);

	// Releasing reports a deactivation exactly once.
	Ev = Tank.Update(false, true, 0.01f);
	CHECK(Ev.bDeactivated && !Ev.bBoosting);
	Ev = Tank.Update(false, true, 0.01f);
	CHECK(!Ev.bDeactivated);
}

static void TestNitrousUpgradeKeepsFraction()
{
	mr::NitrousTank Tank;
	Tank.SetAmount(50.f);
	mr::NitrousConfig Bigger;
	Bigger.Capacity = 200.f;
	Tank.SetConfig(Bigger);
	CHECK_NEAR(Tank.GetAmount(), 100.0, 1e-4);
	CHECK_NEAR(Tank.GetFraction(), 0.5, 1e-6);
}

static void TestNitrousFrameRateIndependent()
{
	auto DrainTime = [](float Dt) {
		mr::NitrousTank Tank;
		float T = 0.f;
		while (Tank.Update(true, true, Dt).bBoosting) T += Dt;
		return T;
	};
	CHECK_NEAR(DrainTime(1.f / 30.f), DrainTime(1.f / 240.f), 0.05);
}

static void TestSteeringScale()
{
	mr::SteeringConfig C;
	CHECK_NEAR(mr::SteeringScaleForSpeed(0.f, C), 1.0, 1e-6);
	CHECK_NEAR(mr::SteeringScaleForSpeed(40.f, C), 1.0, 1e-6);
	CHECK_NEAR(mr::SteeringScaleForSpeed(220.f, C), 0.25, 1e-6);
	CHECK_NEAR(mr::SteeringScaleForSpeed(400.f, C), 0.25, 1e-6);
	CHECK_NEAR(mr::SteeringScaleForSpeed(-130.f, C), mr::SteeringScaleForSpeed(130.f, C), 1e-6);
	float Prev = 1.f;
	for (float Kmh = 0.f; Kmh <= 300.f; Kmh += 5.f) // never increases with speed
	{
		const float S = mr::SteeringScaleForSpeed(Kmh, C);
		CHECK(S <= Prev + 1e-6f);
		Prev = S;
	}
	mr::SteeringConfig Degenerate;
	Degenerate.MinLockAboveKmh = Degenerate.FullLockBelowKmh;
	CHECK_NEAR(mr::SteeringScaleForSpeed(500.f, Degenerate), 1.0, 1e-6);
}

static void TestSteeringSmoothing()
{
	mr::SteeringConfig C; // rise 4/s, return 6/s
	float V = 0.f;
	V = mr::SmoothSteeringInput(V, 1.f, C, 0.1f);
	CHECK_NEAR(V, 0.4, 1e-6);
	for (int i = 0; i < 10; ++i) V = mr::SmoothSteeringInput(V, 1.f, C, 0.1f);
	CHECK_NEAR(V, 1.0, 1e-6); // reaches and never overshoots
	V = mr::SmoothSteeringInput(V, 0.f, C, 0.1f);
	CHECK_NEAR(V, 0.4, 1e-6); // returns faster
	V = mr::SmoothSteeringInput(0.5f, -1.f, C, 0.05f);
	CHECK_NEAR(V, 0.2, 1e-6); // reversing direction uses the return rate
	CHECK_NEAR(mr::SmoothSteeringInput(0.f, 5.f, C, 10.f), 1.0, 1e-6); // target clamped
}

static mr::ArcadeDriveState Run(mr::ArcadeDriveInput In, float Seconds, float Dt, mr::ArcadeDriveState S = {})
{
	const mr::ArcadeDriveConfig C;
	const int Steps = static_cast<int>(std::lround(Seconds / Dt));
	for (int i = 0; i < Steps; ++i) mr::StepArcadeDrive(S, In, C, Dt);
	return S;
}

static void TestArcadeDrive()
{
	mr::ArcadeDriveInput Throttle; Throttle.bThrottle = true;
	mr::ArcadeDriveInput Brake;    Brake.bBrake = true;
	mr::ArcadeDriveInput Coast;

	// 0 -> max takes MaxSpeed / Acceleration = 0.667 s (40 frames in the prototype).
	CHECK_NEAR(Run(Throttle, 0.5f, 1.f / 60.f).Speed, 450.0, 0.5);
	mr::ArcadeDriveState Top = Run(Throttle, 5.f, 1.f / 60.f);
	CHECK_NEAR(Top.Speed, 600.0, 1e-3);
	CHECK_NEAR(Run(Brake, 5.f, 1.f / 60.f).Speed, -300.0, 1e-3);
	CHECK_NEAR(Run(Coast, 1.f, 1.f / 60.f, Top).Speed, 420.0, 0.5);
	CHECK_NEAR(Run(Coast, 10.f, 1.f / 60.f, Top).Speed, 0.0, 1e-6);

	// Boost raises the cap to 1.5x, then bleeds back without snapping.
	mr::ArcadeDriveInput Boost = Throttle; Boost.bBoosting = true;
	mr::ArcadeDriveState Boosted = Run(Boost, 5.f, 1.f / 60.f);
	CHECK_NEAR(Boosted.Speed, 900.0, 1e-3);
	const float After = Run(Throttle, 1.f / 60.f, 1.f / 60.f, Boosted).Speed;
	CHECK(After < 900.f && After > 890.f);
	CHECK_NEAR(Run(Throttle, 5.f, 1.f / 60.f, Boosted).Speed, 600.0, 1e-3);

	// Boost does nothing while stationary or reversing.
	mr::ArcadeDriveInput BoostOnly; BoostOnly.bBoosting = true;
	CHECK_NEAR(Run(BoostOnly, 1.f, 1.f / 60.f).Speed, 0.0, 1e-6);

	// Steering: none at rest, reversed when reversing.
	mr::ArcadeDriveInput SteerOnly; SteerOnly.Steer = 1.f;
	CHECK_NEAR(Run(SteerOnly, 1.f, 1.f / 60.f).AngleDeg, 0.0, 1e-6);
	mr::ArcadeDriveInput Fwd = Throttle; Fwd.Steer = 1.f;
	mr::ArcadeDriveInput Rev = Brake;    Rev.Steer = 1.f;
	CHECK(Run(Fwd, 1.f, 1.f / 60.f).AngleDeg > 0.f);
	CHECK(Run(Rev, 1.f, 1.f / 60.f).AngleDeg < 0.f);

	// Frame-rate independence of speed.
	CHECK_NEAR(Run(Boost, 0.4f, 1.f / 30.f).Speed, Run(Boost, 0.4f, 1.f / 240.f).Speed, 1.0);
}

int main()
{
	TestNitrousDrainAndEvents();
	TestNitrousRecharge();
	TestNitrousGating();
	TestNitrousUpgradeKeepsFraction();
	TestNitrousFrameRateIndependent();
	TestSteeringScale();
	TestSteeringSmoothing();
	TestArcadeDrive();
	std::printf("%d checks, %d failures\n", GChecks, GFailures);
	return GFailures == 0 ? 0 : 1;
}
