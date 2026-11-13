// Tests for the race rules (clock, checkpoints, lap timing, standings) and the
// opponent AI, including full simulated races on the Solaris Coast test block.
#include <cmath>
#include <cstdio>

#include "mr/AIDriver.h"
#include "mr/Checkpoints.h"
#include "mr/LapTimer.h"
#include "mr/Race.h"
#include "mr/Standings.h"
#include "test_harness.h"

using mr::CheckpointResult;

static void TestRaceClock()
{
	mr::RaceClock Clock(3.f);
	CHECK(Clock.GetPhase() == mr::RacePhase::Waiting && Clock.AreInputsLocked());
	Clock.Update(1.f);
	CHECK_NEAR(Clock.GetRaceTime(), 0.0, 1e-6);   // nothing runs while waiting

	Clock.StartCountdown();
	int Ticks[8] = {};
	int TickCount = 0;
	bool bGo = false;
	float Elapsed = 0.f;
	while (!bGo && Elapsed < 10.f)
	{
		const mr::RaceClockEvents Ev = Clock.Update(0.1f);
		Elapsed += 0.1f;
		if (Ev.bCountdownTick && TickCount < 8) Ticks[TickCount++] = Ev.CountdownNumber;
		bGo = Ev.bGo;
		if (!bGo) CHECK(Clock.AreInputsLocked());
	}
	CHECK(TickCount == 3 && Ticks[0] == 3 && Ticks[1] == 2 && Ticks[2] == 1);
	CHECK_NEAR(Elapsed, 3.0, 0.11);
	CHECK(Clock.GetPhase() == mr::RacePhase::Racing && !Clock.AreInputsLocked());

	Clock.StartCountdown();   // ignored once racing
	CHECK(Clock.GetPhase() == mr::RacePhase::Racing);
	const float T0 = Clock.GetRaceTime();
	Clock.Update(2.5f);
	CHECK_NEAR(Clock.GetRaceTime() - T0, 2.5, 1e-5);
	Clock.Finish();
	Clock.Update(5.f);
	CHECK_NEAR(Clock.GetRaceTime() - T0, 2.5, 1e-5);   // frozen after the finish

	// The overshoot of the step that crosses GO counts as race time (frame-rate independent start).
	mr::RaceClock Coarse(3.f);
	Coarse.StartCountdown();
	Coarse.Update(2.9f);
	CHECK(Coarse.Update(0.3f).bGo);
	CHECK_NEAR(Coarse.GetRaceTime(), 0.2, 1e-5);
}

static void TestCheckpointOrderAndLaps()
{
	const int N = 6, Laps = 2;
	mr::RacerProgress P;
	CHECK(mr::DisplayLap(P, Laps) == 1);

	CHECK(mr::PassCheckpoint(P, 3, N, Laps) == CheckpointResult::WrongCheckpoint);   // must cross the line first
	CHECK(mr::PassCheckpoint(P, 0, N, Laps) == CheckpointResult::Advanced);          // start line: lap 1 begins
	CHECK(P.LapsCompleted == 0);
	CHECK(mr::PassCheckpoint(P, 0, N, Laps) == CheckpointResult::WrongCheckpoint);   // reversing over the line gains nothing
	CHECK(mr::PassCheckpoint(P, 2, N, Laps) == CheckpointResult::WrongCheckpoint);   // skipping (a shortcut) is rejected
	for (int i = 1; i < N; ++i) CHECK(mr::PassCheckpoint(P, i, N, Laps) == CheckpointResult::Advanced);
	CHECK(mr::PassCheckpoint(P, 0, N, Laps) == CheckpointResult::LapCompleted);
	CHECK(P.LapsCompleted == 1 && mr::DisplayLap(P, Laps) == 2);
	for (int i = 1; i < N; ++i) mr::PassCheckpoint(P, i, N, Laps);
	CHECK(mr::PassCheckpoint(P, 0, N, Laps) == CheckpointResult::RaceFinished);
	CHECK(P.bFinished && P.LapsCompleted == 2 && mr::DisplayLap(P, Laps) == 2);
	CHECK(P.CheckpointsPassed == 1 + 2 * N);
	CHECK(mr::PassCheckpoint(P, 1, N, Laps) == CheckpointResult::Ignored);           // nothing counts after the finish
	CHECK(mr::PassCheckpoint(P, 99, N, Laps) == CheckpointResult::Ignored);
}

static void TestGateCrossing()
{
	mr::Gate G;   // at the origin, travelling +X, 1000 either side
	CHECK(mr::GateCrossing(G, -50, 0, 50, 0) == 1);
	CHECK(mr::GateCrossing(G, 50, 0, -50, 0) == -1);
	CHECK(mr::GateCrossing(G, -50, 0, -10, 0) == 0);
	CHECK(mr::GateCrossing(G, -5000, 300, 5000, 300) == 1);    // very fast car cannot tunnel through
	CHECK(mr::GateCrossing(G, -50, 1500, 50, 1500) == 0);      // outside the gate's width
	CHECK(mr::GateCrossing(G, -50, 900, 50, 1100) == 1);       // crossing point (y = 1000) is just inside

	mr::Gate Up;
	Up.X = 100; Up.Y = 200; Up.DirX = 0; Up.DirY = 1; Up.HalfWidth = 500;
	CHECK(mr::GateCrossing(Up, 150, 190, 150, 210) == 1);
	CHECK(mr::GateCrossing(Up, 150, 210, 150, 190) == -1);
	CHECK(mr::GateCrossing(Up, 700, 190, 700, 210) == 0);
}

static void TestWrongWay()
{
	mr::WrongWayDetector D;
	bool bWarn = false;
	for (int i = 0; i < 100; ++i) bWarn = D.Update(-1.f, 2000.f, 0.01f);
	CHECK(!bWarn);                                   // 1.0 s: not yet
	for (int i = 0; i < 60; ++i) bWarn = D.Update(-1.f, 2000.f, 0.01f);
	CHECK(bWarn);                                    // 1.6 s facing backwards at speed
	CHECK(!D.Update(1.f, 2000.f, 0.01f));            // turning round clears it at once
	for (int i = 0; i < 300; ++i) bWarn = D.Update(-1.f, 100.f, 0.01f);
	CHECK(!bWarn);                                   // nearly stopped (recovering from a spin)
	for (int i = 0; i < 300; ++i) bWarn = D.Update(0.2f, 2000.f, 0.01f);
	CHECK(!bWarn);                                   // sideways in a drift is fine
}

static void TestLapTimer()
{
	mr::LapTimer T;
	float Delta = 0.f;
	CHECK(T.GetBestLap() < 0.f && T.GetLastLap() < 0.f);
	CHECK_NEAR(T.GetCurrentLapTime(12.5f), 12.5, 1e-6);       // lap 1 runs from GO

	CHECK(!T.OnCheckpoint(1, 10.f, Delta));                    // no best lap to compare with yet
	CHECK(!T.OnCheckpoint(2, 20.f, Delta));
	CHECK_NEAR(T.OnLapCompleted(40.f), 40.0, 1e-6);
	CHECK_NEAR(T.GetBestLap(), 40.0, 1e-6);
	CHECK_NEAR(T.GetCurrentLapTime(45.f), 5.0, 1e-6);

	CHECK(T.OnCheckpoint(1, 48.f, Delta));                     // 8.0 vs 10.0
	CHECK_NEAR(Delta, -2.0, 1e-5);
	CHECK(T.OnCheckpoint(2, 63.f, Delta));                     // 23.0 vs 20.0
	CHECK_NEAR(Delta, 3.0, 1e-5);
	CHECK_NEAR(T.OnLapCompleted(82.f), 42.0, 1e-5);            // slower lap: best and its splits unchanged
	CHECK_NEAR(T.GetBestLap(), 40.0, 1e-6);
	CHECK_NEAR(T.GetLastLap(), 42.0, 1e-5);

	T.OnCheckpoint(1, 91.f, Delta);                            // 9.0
	CHECK_NEAR(Delta, -1.0, 1e-5);
	CHECK_NEAR(T.OnLapCompleted(120.f), 38.0, 1e-5);           // new best
	CHECK_NEAR(T.GetBestLap(), 38.0, 1e-5);
	CHECK(T.OnCheckpoint(1, 129.f, Delta));
	CHECK_NEAR(Delta, 0.0, 1e-5);                              // compared with the new best lap's split
	CHECK(!T.OnCheckpoint(2, 140.f, Delta));                   // best lap had no split recorded at 2
	CHECK(T.GetLapsTimed() == 3);
	CHECK(!T.OnCheckpoint(0, 1.f, Delta) && !T.OnCheckpoint(mr::MaxCheckpoints, 1.f, Delta));
}

static void TestStandingsAndResults()
{
	mr::RacerStanding S[4];
	S[0].RacerId = 10; S[0].CheckpointsPassed = 7; S[0].DistanceToNext = 900.f; S[0].LapsCompleted = 1;
	S[1].RacerId = 11; S[1].CheckpointsPassed = 8; S[1].DistanceToNext = 5000.f; S[1].LapsCompleted = 1;
	S[2].RacerId = 12; S[2].CheckpointsPassed = 7; S[2].DistanceToNext = 300.f; S[2].LapsCompleted = 1;
	S[3].RacerId = 13; S[3].CheckpointsPassed = 2; S[3].DistanceToNext = 10.f; S[3].LapsCompleted = 0;
	mr::SortStandings(S, 4);
	CHECK(S[0].RacerId == 11 && S[1].RacerId == 12 && S[2].RacerId == 10 && S[3].RacerId == 13);
	CHECK(mr::PositionOf(S, 4, 10) == 3 && mr::PositionOf(S, 4, 99) == 0);

	// Finished racers always rank ahead, ordered by finish time.
	mr::RacerStanding F[4];
	F[0].RacerId = 1; F[0].CheckpointsPassed = 12; F[0].LapsCompleted = 1;
	F[1].RacerId = 2; F[1].bFinished = true; F[1].FinishTime = 95.5f; F[1].LapsCompleted = 3; F[1].BestLap = 30.f;
	F[2].RacerId = 3; F[2].bFinished = true; F[2].FinishTime = 92.0f; F[2].LapsCompleted = 3; F[2].BestLap = 29.f;
	F[3].RacerId = 4; F[3].CheckpointsPassed = 18; F[3].LapsCompleted = 2;
	mr::SortStandings(F, 4);
	CHECK(F[0].RacerId == 3 && F[1].RacerId == 2 && F[2].RacerId == 4 && F[3].RacerId == 1);

	mr::ResultRow Rows[4];
	CHECK(mr::BuildResults(F, 4, Rows) == 4);
	CHECK(Rows[0].Position == 1 && Rows[0].RacerId == 3 && Rows[0].bFinished);
	CHECK_NEAR(Rows[0].GapToWinner, 0.0, 1e-6);
	CHECK_NEAR(Rows[1].GapToWinner, 3.5, 1e-5);
	CHECK_NEAR(Rows[1].TotalTime, 95.5, 1e-5);
	CHECK(!Rows[2].bFinished && Rows[2].LapsBehind == 1);
	CHECK(!Rows[3].bFinished && Rows[3].LapsBehind == 2 && Rows[3].Position == 4);
	CHECK_NEAR(Rows[0].BestLap, 29.0, 1e-6);
}

// ---------------------------------------------------------------- simulated race
// The same rounded-rectangle loop as blender/build_track.py (cm).
namespace track
{
const float HalfX = 20000.f, HalfY = 12000.f, CornerR = 6000.f, RoadHalfWidth = 700.f;
const float Pi = 3.14159265f;
const int MaxPoints = 256;

static int BuildLine(mr::LinePoint* Pts)
{
	const float SX = HalfX - CornerR, SY = HalfY - CornerR;
	int N = 0;
	auto Straight = [&](float X0, float Y0, float X1, float Y1) {
		const float Len = std::sqrt((X1 - X0) * (X1 - X0) + (Y1 - Y0) * (Y1 - Y0));
		const int Steps = static_cast<int>(std::lround(Len / 1000.f));
		for (int i = 0; i < Steps; ++i) { Pts[N].X = X0 + (X1 - X0) * i / Steps; Pts[N].Y = Y0 + (Y1 - Y0) * i / Steps; ++N; }
	};
	auto Arc = [&](float CX, float CY, float StartDeg) {
		for (int i = 0; i < 16; ++i)
		{
			const float A = (StartDeg + 90.f * i / 16) * Pi / 180.f;
			Pts[N].X = CX + CornerR * std::cos(A); Pts[N].Y = CY + CornerR * std::sin(A); ++N;
		}
	};
	Straight(0, -HalfY, SX, -HalfY);  Arc(SX, -SY, -90);
	Straight(HalfX, -SY, HalfX, SY);  Arc(SX, SY, 0);
	Straight(SX, HalfY, -SX, HalfY);  Arc(-SX, SY, 90);
	Straight(-HalfX, SY, -HalfX, -SY); Arc(-SX, -SY, 180);
	Straight(-SX, -HalfY, 0, -HalfY);
	mr::ComputeLineRadii(Pts, N);
	return N;
}

static float DistanceToCentreline(float X, float Y)
{
	const float QX = std::fabs(X) - (HalfX - CornerR), QY = std::fabs(Y) - (HalfY - CornerR);
	const float MX = QX > 0 ? QX : 0, MY = QY > 0 ? QY : 0;
	const float Inner = (QX > QY ? QX : QY) < 0 ? (QX > QY ? QX : QY) : 0;
	return std::fabs(std::sqrt(MX * MX + MY * MY) + Inner - CornerR);
}
} // namespace track

struct SimCar
{
	float X = -3000.f, Y = -track::HalfY, Heading = 0.f, Speed = 0.f;
	mr::AIDriver Driver;
	mr::AIDriverConfig Config;
	mr::RacerProgress Progress;
	mr::LapTimer Timer;
	float FinishTime = -1.f;
	float MaxOffLine = 0.f;
	float MaxSpeed = 0.f;
};

/** Simple car: pedals change speed, front wheels steer it (bicycle model), grip limits how tightly it can turn. */
static void StepCar(SimCar& Car, const mr::AIDriverOutput& Cmd, float Dt)
{
	const float Accel = 900.f, Brake = 1500.f, Drag = 0.05f, GripAccel = 1250.f;
	const float Wheelbase = 262.f, MaxSteerRad = 40.f * track::Pi / 180.f;
	Car.Speed += (Cmd.Throttle * Accel - Cmd.Brake * Brake - Drag * Car.Speed) * Dt;
	if (Car.Speed < 0.f) Car.Speed = 0.f;
	float YawRate = Car.Speed * std::tan(Cmd.Steer * MaxSteerRad) / Wheelbase;
	if (Car.Speed > 1.f) YawRate = mr::Clamp(YawRate, -GripAccel / Car.Speed, GripAccel / Car.Speed);   // understeer past the grip limit
	Car.Heading += YawRate * Dt;
	Car.X += std::cos(Car.Heading) * Car.Speed * Dt;
	Car.Y += std::sin(Car.Heading) * Car.Speed * Dt;
}

/** Run one car for a full race. Returns false if it never finishes. */
static bool RunRace(SimCar& Car, int Laps, float Dt, const mr::LinePoint* Line, int Count, const mr::Gate* Gates, int GateCount)
{
	mr::RaceClock Clock(3.f);
	Clock.StartCountdown();
	for (int Step = 0; Step < static_cast<int>(600.f / Dt); ++Step)
	{
		Clock.Update(Dt);
		if (Clock.AreInputsLocked()) continue;

		mr::AIDriverInput In;
		In.X = Car.X; In.Y = Car.Y; In.Speed = Car.Speed;
		In.ForwardX = std::cos(Car.Heading); In.ForwardY = std::sin(Car.Heading);
		const mr::AIDriverOutput Cmd = Car.Driver.Update(In, Line, Count, Car.Config);

		const float PrevX = Car.X, PrevY = Car.Y;
		StepCar(Car, Cmd, Dt);
		Car.MaxOffLine = mr::Max(Car.MaxOffLine, track::DistanceToCentreline(Car.X, Car.Y));
		Car.MaxSpeed = mr::Max(Car.MaxSpeed, Car.Speed);

		const int Next = Car.Progress.NextCheckpoint;
		if (Next < GateCount && mr::GateCrossing(Gates[Next], PrevX, PrevY, Car.X, Car.Y) == 1)
		{
			const bool bStarted = Car.Progress.bCrossedStart;
			const CheckpointResult R = mr::PassCheckpoint(Car.Progress, Next, GateCount, Laps);
			float Delta = 0.f;
			if (Next != 0) Car.Timer.OnCheckpoint(Next, Clock.GetRaceTime(), Delta);
			else if (bStarted) Car.Timer.OnLapCompleted(Clock.GetRaceTime());
			if (R == CheckpointResult::RaceFinished)
			{
				Car.FinishTime = Clock.GetRaceTime();
				return true;
			}
		}
	}
	return false;
}

static int BuildGates(const mr::LinePoint* Line, int Count, mr::Gate* Gates, int GateCount)
{
	for (int g = 0; g < GateCount; ++g)
	{
		const int i = (Count * g) / GateCount;
		const int j = (i + 1) % Count;
		const float DX = Line[j].X - Line[i].X, DY = Line[j].Y - Line[i].Y;
		const float Len = std::sqrt(DX * DX + DY * DY);
		Gates[g].X = Line[i].X; Gates[g].Y = Line[i].Y;
		Gates[g].DirX = DX / Len; Gates[g].DirY = DY / Len;
		Gates[g].HalfWidth = 1000.f;
	}
	return GateCount;
}

static void TestLineRadii()
{
	mr::LinePoint Line[track::MaxPoints];
	const int Count = track::BuildLine(Line);
	CHECK(Count > 60 && Count < track::MaxPoints);
	int Straights = 0, Corners = 0, Tight = 0;
	for (int i = 0; i < Count; ++i)
	{
		if (Line[i].Radius <= 0.f) { ++Straights; continue; }
		++Corners;
		CHECK(Line[i].Radius > 5500.f);            // never tighter than the real 60 m corners
		if (Line[i].Radius < 6500.f) ++Tight;      // corner entry/exit points read wider, which is correct
	}
	CHECK(Straights > 20 && Corners >= 56 && Tight >= 48);
}

static void TestAIFinishesARaceOnTheRoad()
{
	mr::LinePoint Line[track::MaxPoints];
	const int Count = track::BuildLine(Line);
	mr::Gate Gates[6];
	BuildGates(Line, Count, Gates, 6);

	SimCar Car;
	CHECK(RunRace(Car, 3, 1.f / 60.f, Line, Count, Gates, 6));
	CHECK(Car.Progress.bFinished && Car.Progress.LapsCompleted == 3);
	CHECK(Car.MaxOffLine < track::RoadHalfWidth - 100.f);   // stays on the road with a car's width to spare
	CHECK(Car.Timer.GetLapsTimed() == 3);
	CHECK(Car.Timer.GetBestLap() > 20.f && Car.Timer.GetBestLap() < 60.f);   // 1.18 km lap
	CHECK(Car.MaxSpeed > 4000.f);                            // actually uses the straights
	CHECK(Car.FinishTime > 3.f * Car.Timer.GetBestLap() - 1.f);
	std::printf("  AI skill 1.00: best lap %.2f s, race %.2f s, max %.0f km/h, max off-line %.0f cm\n",
		Car.Timer.GetBestLap(), Car.FinishTime, Car.MaxSpeed * 0.036f, Car.MaxOffLine);
}

static void TestAISkillAndRubberBand()
{
	mr::LinePoint Line[track::MaxPoints];
	const int Count = track::BuildLine(Line);
	mr::Gate Gates[6];
	BuildGates(Line, Count, Gates, 6);

	float Times[3];
	const float Skills[3] = { 0.75f, 0.9f, 1.0f };
	for (int k = 0; k < 3; ++k)
	{
		SimCar Car;
		Car.Config.Skill = Skills[k];
		CHECK(RunRace(Car, 2, 1.f / 60.f, Line, Count, Gates, 6));
		CHECK(Car.MaxOffLine < track::RoadHalfWidth - 100.f);
		Times[k] = Car.FinishTime;
		std::printf("  AI skill %.2f: 2 laps in %.2f s\n", Skills[k], Car.FinishTime);
	}
	CHECK(Times[0] > Times[1] && Times[1] > Times[2]);       // more skill is faster

	// Rubber-banding only nudges the target speed, within its limit.
	mr::AIDriver Driver;
	mr::AIDriverConfig Config;
	mr::AIDriverInput In;
	In.X = 1000.f; In.Y = -track::HalfY; In.Speed = 3000.f;
	const float Base = Driver.Update(In, Line, Count, Config).TargetSpeed;
	In.GapToPlayer = 100000.f;
	const float Chasing = Driver.Update(In, Line, Count, Config).TargetSpeed;
	In.GapToPlayer = -100000.f;
	const float Leading = Driver.Update(In, Line, Count, Config).TargetSpeed;
	CHECK(Chasing > Base && Base > Leading);
	CHECK(Chasing <= Base * 1.1001f && Leading >= Base * 0.8999f);

	// Frame-rate independence: a 30 FPS race takes about as long as a 120 FPS one.
	SimCar Slow, Fast;
	CHECK(RunRace(Slow, 1, 1.f / 30.f, Line, Count, Gates, 6));
	CHECK(RunRace(Fast, 1, 1.f / 120.f, Line, Count, Gates, 6));
	CHECK_NEAR(Slow.FinishTime, Fast.FinishTime, 0.6);
}

static void TestAISteeringDirectionAndRecovery()
{
	mr::LinePoint Line[track::MaxPoints];
	const int Count = track::BuildLine(Line);
	mr::AIDriverConfig Config;

	// On the bottom straight heading +X: a car left of the line (+Y side here is towards the infield)
	// must steer back towards it.
	mr::AIDriver A;
	mr::AIDriverInput In;
	In.X = 2000.f; In.Y = -track::HalfY + 400.f; In.Speed = 2000.f;
	CHECK(A.Update(In, Line, Count, Config).Steer < -0.05f);    // target is towards -Y
	mr::AIDriver B;
	In.Y = -track::HalfY - 400.f;
	CHECK(B.Update(In, Line, Count, Config).Steer > 0.05f);     // target is towards +Y

	// Too fast for the corner ahead: brakes instead of accelerating.
	mr::AIDriver C;
	In.X = 12500.f; In.Y = -track::HalfY; In.Speed = 6000.f;
	const mr::AIDriverOutput Out = C.Update(In, Line, Count, Config);
	CHECK(Out.Brake > 0.f && Out.Throttle == 0.f);
	CHECK(Out.TargetSpeed < 6000.f);

	// Degenerate input never crashes.
	mr::AIDriver D;
	CHECK(D.Update(In, nullptr, 0, Config).Throttle == 0.f);
}

int main()
{
	TestRaceClock();
	TestCheckpointOrderAndLaps();
	TestGateCrossing();
	TestWrongWay();
	TestLapTimer();
	TestStandingsAndResults();
	TestLineRadii();
	TestAIFinishesARaceOnTheRoad();
	TestAISkillAndRubberBand();
	TestAISteeringDirectionAndRecovery();
	std::printf("%d checks, %d failures\n", GChecks, GFailures);
	return GFailures == 0 ? 0 : 1;
}
