// Minimal dependency-free test macros shared by the core test programs.
#pragma once

#include <cmath>
#include <cstdio>

static int GFailures = 0;
static int GChecks = 0;

#define CHECK(Cond) \
	do { ++GChecks; if (!(Cond)) { ++GFailures; std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #Cond); } } while (0)
#define CHECK_NEAR(A, B, Tol) \
	do { ++GChecks; const double A_ = (A), B_ = (B); if (std::fabs(A_ - B_) > (Tol)) { ++GFailures; \
		std::printf("FAIL %s:%d  %s = %g, expected %g\n", __FILE__, __LINE__, #A, A_, B_); } } while (0)

